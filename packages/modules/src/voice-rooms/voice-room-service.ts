import { ExpiringCache, KeyedMutex, type Clock } from "@lunaecho/core";

import type { RoomDetails, VoiceRoomPlatform } from "./voice-room-platform.js";
import type { SaveLobbyResult, VoiceRoomRepository } from "./voice-room-repository.js";
import {
  maximumLobbiesPerGuild,
  renderRoomName,
  roomCreationCooldownMilliseconds,
  technicalMaximumRoomsPerGuild,
  validateNameTemplate,
  validateRoomName,
  validateUserLimit,
  type VoiceRoom,
  type VoiceRoomLobby,
} from "./voice-room.js";

export type VoiceStateChange = Readonly<{
  displayName: string;
  guildId: string;
  /** Bots, such as music bots, never get a room of their own. */
  isBot?: boolean;
  newChannelId: string | null;
  oldChannelId: string | null;
  userId: string;
}>;

export type VoiceRoomEvent =
  | Readonly<{ kind: "creation-refused"; reason: "cooldown" | "limit-reached" | "module-off" }>
  | Readonly<{ kind: "moved-to-own-room"; room: VoiceRoom }>
  | Readonly<{ kind: "room-created"; room: VoiceRoom }>
  | Readonly<{ kind: "room-deleted"; channelId: string }>;

export type RoomActor = Readonly<{
  /** The voice channel the member is connected to, or null when not in voice. */
  channelId: string | null;
  userId: string;
}>;

export type RoomActionResult =
  "done" | "invalid-target" | "not-in-room" | "not-owner" | "owner-present" | "rate-limited";

/** Discord accepts two name changes per channel every ten minutes and queues the rest. */
const renamesPerWindow = 2;
const renameWindowMilliseconds = 600_000;

export type RoomInfo = Readonly<{
  details: RoomDetails | undefined;
  occupantCount: number;
  room: VoiceRoom;
}>;

export type LobbyInput = Readonly<{
  actorId: string;
  categoryId: string | null;
  channelId: string;
  guildId: string;
  nameTemplate: string;
  userLimit: number;
}>;

export type VoiceRoomServiceOptions = Readonly<{
  /** Whether new rooms may be opened: the module is enabled and the plan includes it. */
  canCreateRooms?: (guildId: string) => Promise<boolean>;
  clock?: Clock;
  /** How many rooms a guild may have open at once; null uses the technical maximum. */
  resolveRoomLimit?: (guildId: string) => Promise<number | null>;
}>;

type OwnerAction = (room: VoiceRoom) => Promise<RoomActionResult>;

/**
 * Join-to-create voice rooms. Every change for one guild runs in order, so a member hopping
 * between channels can never open two rooms or delete a room that someone just joined.
 *
 * Deleting empty rooms continues while the module is switched off, so disabling it never leaves
 * abandoned channels behind; only opening new rooms stops.
 */
export class VoiceRoomService {
  private readonly canCreateRooms: (guildId: string) => Promise<boolean>;
  private readonly clock: Clock;
  private readonly cooldowns: ExpiringCache<string, true>;
  private readonly lobbies: ExpiringCache<string, readonly VoiceRoomLobby[]>;
  /** Channels LunaEcho created as rooms, so logs can leave them out. */
  private readonly managedChannels: ExpiringCache<string, true>;
  private readonly mutex = new KeyedMutex<string>();
  private readonly renames: ExpiringCache<string, readonly number[]>;
  private readonly resolveRoomLimit: (guildId: string) => Promise<number | null>;
  /** The database is the source of truth; this only saves a query on every voice event. */
  private readonly rooms: ExpiringCache<string, Map<string, VoiceRoom>>;

  public constructor(
    private readonly repository: VoiceRoomRepository,
    private readonly platform: VoiceRoomPlatform,
    options: VoiceRoomServiceOptions = {},
  ) {
    this.canCreateRooms = options.canCreateRooms ?? (() => Promise.resolve(true));
    this.clock = options.clock ?? (() => new Date());
    this.resolveRoomLimit = options.resolveRoomLimit ?? (() => Promise.resolve(null));
    this.cooldowns = new ExpiringCache({
      clock: this.clock,
      maximumEntries: 100_000,
      ttlMilliseconds: roomCreationCooldownMilliseconds,
    });
    this.lobbies = new ExpiringCache({
      clock: this.clock,
      maximumEntries: 20_000,
      ttlMilliseconds: 60_000,
    });
    this.managedChannels = new ExpiringCache({
      clock: this.clock,
      maximumEntries: 100_000,
      ttlMilliseconds: 7 * 86_400_000,
    });
    this.renames = new ExpiringCache({
      clock: this.clock,
      maximumEntries: 20_000,
      ttlMilliseconds: renameWindowMilliseconds,
    });
    this.rooms = new ExpiringCache({
      clock: this.clock,
      maximumEntries: 20_000,
      ttlMilliseconds: 600_000,
    });
  }

  public handleVoiceStateChange(change: VoiceStateChange): Promise<readonly VoiceRoomEvent[]> {
    // Muting, deafening, and streaming also emit voice state updates without a channel change.
    if (change.oldChannelId === change.newChannelId) {
      return Promise.resolve([]);
    }

    return this.mutex.run(change.guildId, async () => {
      const events: VoiceRoomEvent[] = [];

      if (change.oldChannelId !== null) {
        const deleted = await this.deleteIfEmpty(change.guildId, change.oldChannelId);

        if (deleted) {
          events.push({ channelId: change.oldChannelId, kind: "room-deleted" });
        }
      }

      if (change.newChannelId !== null && change.isBot !== true) {
        const event = await this.handleJoin(change, change.newChannelId);

        if (event !== undefined) {
          events.push(event);
        }
      }

      return events;
    });
  }

  /** Forgets a room or lobby channel that was deleted outside LunaEcho. */
  public handleChannelDeleted(guildId: string, channelId: string): Promise<void> {
    return this.mutex.run(guildId, async () => {
      const rooms = await this.getRooms(guildId);

      if (rooms.delete(channelId)) {
        await this.repository.deleteRoom(channelId);
      }

      if (await this.repository.removeLobby(guildId, channelId)) {
        this.lobbies.delete(guildId);
      }
    });
  }

  /**
   * Deletes stored rooms that emptied or disappeared while the bot was offline. Guilds that are
   * currently unavailable are skipped, because their channels cannot be checked.
   */
  public async reconcile(isGuildAvailable: (guildId: string) => boolean): Promise<number> {
    let removed = 0;

    for (const guildId of await this.repository.listRoomGuildIds()) {
      if (!isGuildAvailable(guildId)) {
        continue;
      }

      removed += await this.mutex.run(guildId, async () => {
        let removedInGuild = 0;
        this.rooms.delete(guildId);

        for (const room of await this.repository.listRooms(guildId)) {
          if (!this.platform.roomExists(guildId, room.channelId)) {
            await this.repository.deleteRoom(room.channelId);
            removedInGuild += 1;
          } else if (await this.deleteIfEmpty(guildId, room.channelId)) {
            removedInGuild += 1;
          }
        }

        return removedInGuild;
      });
    }

    return removed;
  }

  /** Whether LunaEcho created this channel as a voice room. */
  public isManagedRoom(channelId: string): boolean {
    return this.managedChannels.get(channelId) !== undefined;
  }

  /** Drops the cached lobbies, for example after the dashboard changed them. */
  public invalidate(guildId: string): void {
    this.lobbies.delete(guildId);
  }

  public listLobbies(guildId: string): Promise<readonly VoiceRoomLobby[]> {
    return this.getLobbies(guildId);
  }

  public async listRooms(guildId: string): Promise<readonly VoiceRoom[]> {
    return [...(await this.mutex.run(guildId, () => this.getRooms(guildId))).values()];
  }

  public async saveLobby(input: LobbyInput): Promise<SaveLobbyResult> {
    const result = await this.repository.saveLobby(
      {
        categoryId: input.categoryId,
        channelId: input.channelId,
        createdAt: this.clock(),
        createdBy: input.actorId,
        guildId: input.guildId,
        nameTemplate: validateNameTemplate(input.nameTemplate),
        userLimit: validateUserLimit(input.userLimit),
      },
      maximumLobbiesPerGuild,
    );
    this.lobbies.delete(input.guildId);
    return result;
  }

  public async removeLobby(guildId: string, channelId: string): Promise<boolean> {
    const removed = await this.repository.removeLobby(guildId, channelId);
    this.lobbies.delete(guildId);
    return removed;
  }

  public getRoomInfo(guildId: string, actor: RoomActor): Promise<RoomInfo | undefined> {
    return this.mutex.run(guildId, async () => {
      const room = await this.findActorRoom(guildId, actor);

      return room === undefined
        ? undefined
        : {
            details: this.platform.getRoomDetails(guildId, room.channelId),
            occupantCount: this.platform.occupantIds(guildId, room.channelId).length,
            room,
          };
    });
  }

  public renameRoom(guildId: string, actor: RoomActor, name: string): Promise<RoomActionResult> {
    const validName = validateRoomName(name);
    return this.runOwnerAction(guildId, actor, async (room) => {
      const now = this.clock().getTime();
      const recent = (this.renames.get(room.channelId) ?? []).filter(
        (timestamp) => timestamp > now - renameWindowMilliseconds,
      );

      // Refusing is better than a command that silently waits minutes for Discord.
      if (recent.length >= renamesPerWindow) {
        return "rate-limited";
      }

      await this.platform.renameRoom(guildId, room.channelId, validName);
      this.renames.set(room.channelId, [...recent, now]);
      return "done";
    });
  }

  public setUserLimit(guildId: string, actor: RoomActor, limit: number): Promise<RoomActionResult> {
    const validLimit = validateUserLimit(limit);
    return this.runOwnerAction(guildId, actor, async (room) => {
      await this.platform.setUserLimit(guildId, room.channelId, validLimit);
      return "done";
    });
  }

  public setLocked(guildId: string, actor: RoomActor, locked: boolean): Promise<RoomActionResult> {
    return this.runOwnerAction(guildId, actor, async (room) => {
      await this.platform.setRoomAccess(guildId, room.channelId, { locked });
      return "done";
    });
  }

  public setHidden(guildId: string, actor: RoomActor, hidden: boolean): Promise<RoomActionResult> {
    return this.runOwnerAction(guildId, actor, async (room) => {
      await this.platform.setRoomAccess(guildId, room.channelId, { hidden });
      return "done";
    });
  }

  public permitMember(
    guildId: string,
    actor: RoomActor,
    targetId: string,
  ): Promise<RoomActionResult> {
    return this.runOwnerAction(guildId, actor, async (room) => {
      if (targetId === actor.userId) {
        return "invalid-target";
      }

      await this.platform.setMemberAccess(guildId, room.channelId, targetId, "permit");
      return "done";
    });
  }

  /** Blocks a member from the room and disconnects them if they are inside. */
  public rejectMember(
    guildId: string,
    actor: RoomActor,
    targetId: string,
  ): Promise<RoomActionResult> {
    return this.runOwnerAction(guildId, actor, async (room) => {
      if (targetId === actor.userId) {
        return "invalid-target";
      }

      await this.platform.setMemberAccess(guildId, room.channelId, targetId, "reject");

      if (this.platform.occupantIds(guildId, room.channelId).includes(targetId)) {
        await this.platform.disconnectMember(guildId, targetId);
      }

      return "done";
    });
  }

  public kickMember(
    guildId: string,
    actor: RoomActor,
    targetId: string,
  ): Promise<RoomActionResult> {
    return this.runOwnerAction(guildId, actor, async (room) => {
      if (
        targetId === actor.userId ||
        !this.platform.occupantIds(guildId, room.channelId).includes(targetId)
      ) {
        return "invalid-target";
      }

      await this.platform.disconnectMember(guildId, targetId);
      return "done";
    });
  }

  public transferRoom(
    guildId: string,
    actor: RoomActor,
    targetId: string,
  ): Promise<RoomActionResult> {
    return this.runOwnerAction(guildId, actor, async (room) => {
      if (
        targetId === actor.userId ||
        !this.platform.occupantIds(guildId, room.channelId).includes(targetId)
      ) {
        return "invalid-target";
      }

      await this.changeOwner(room, targetId);
      return "done";
    });
  }

  /** Lets a member inside the room take it over once the owner has left. */
  public claimRoom(guildId: string, actor: RoomActor): Promise<RoomActionResult> {
    return this.mutex.run(guildId, async () => {
      const room = await this.findActorRoom(guildId, actor);

      if (room === undefined) {
        return "not-in-room";
      }

      if (room.ownerId === actor.userId) {
        return "done";
      }

      if (this.platform.occupantIds(guildId, room.channelId).includes(room.ownerId)) {
        return "owner-present";
      }

      await this.changeOwner(room, actor.userId);
      return "done";
    });
  }

  private async changeOwner(room: VoiceRoom, newOwnerId: string): Promise<void> {
    await this.platform.revokeOwnerPermissions(room.guildId, room.channelId, room.ownerId);
    await this.platform.grantOwnerPermissions(room.guildId, room.channelId, newOwnerId);
    await this.repository.setRoomOwner(room.channelId, newOwnerId);
    (await this.getRooms(room.guildId)).set(room.channelId, { ...room, ownerId: newOwnerId });
  }

  private async deleteIfEmpty(guildId: string, channelId: string): Promise<boolean> {
    const rooms = await this.getRooms(guildId);
    const room = rooms.get(channelId);

    if (room === undefined || this.platform.occupantIds(guildId, channelId).length > 0) {
      return false;
    }

    // The record goes first: if Discord already deleted the channel, nothing is left behind.
    rooms.delete(channelId);
    await this.repository.deleteRoom(channelId);

    if (this.platform.roomExists(guildId, channelId)) {
      await this.platform.deleteRoom(guildId, channelId);
    }

    return true;
  }

  private async findActorRoom(guildId: string, actor: RoomActor): Promise<VoiceRoom | undefined> {
    return actor.channelId === null
      ? undefined
      : (await this.getRooms(guildId)).get(actor.channelId);
  }

  private async getLobbies(guildId: string): Promise<readonly VoiceRoomLobby[]> {
    const cached = this.lobbies.get(guildId);

    if (cached !== undefined) {
      return cached;
    }

    const lobbies = await this.repository.listLobbies(guildId);
    this.lobbies.set(guildId, lobbies);
    return lobbies;
  }

  private async getRooms(guildId: string): Promise<Map<string, VoiceRoom>> {
    const cached = this.rooms.get(guildId);

    if (cached !== undefined) {
      return cached;
    }

    const rooms = new Map(
      (await this.repository.listRooms(guildId)).map((room) => [room.channelId, room] as const),
    );
    this.rooms.set(guildId, rooms);
    return rooms;
  }

  private async handleJoin(
    change: VoiceStateChange,
    channelId: string,
  ): Promise<VoiceRoomEvent | undefined> {
    const lobby = (await this.getLobbies(change.guildId)).find(
      (candidate) => candidate.channelId === channelId,
    );

    if (lobby === undefined) {
      return undefined;
    }

    if (!(await this.canCreateRooms(change.guildId))) {
      return { kind: "creation-refused", reason: "module-off" };
    }

    const rooms = await this.getRooms(change.guildId);
    const ownRoom = [...rooms.values()].find(
      (room) =>
        room.ownerId === change.userId && this.platform.roomExists(change.guildId, room.channelId),
    );

    if (ownRoom !== undefined) {
      await this.platform.moveMember(change.guildId, change.userId, ownRoom.channelId);
      return { kind: "moved-to-own-room", room: ownRoom };
    }

    const cooldownKey = `${change.guildId}:${change.userId}`;

    if (this.cooldowns.get(cooldownKey) !== undefined) {
      return { kind: "creation-refused", reason: "cooldown" };
    }

    const limit = (await this.resolveRoomLimit(change.guildId)) ?? technicalMaximumRoomsPerGuild;

    if (rooms.size >= Math.min(limit, technicalMaximumRoomsPerGuild)) {
      return { kind: "creation-refused", reason: "limit-reached" };
    }

    const roomChannelId = await this.platform.createRoom({
      guildId: change.guildId,
      lobbyChannelId: lobby.channelId,
      name: renderRoomName(lobby.nameTemplate, change.displayName),
      ownerId: change.userId,
      parentId: lobby.categoryId,
      userLimit: lobby.userLimit,
    });
    const room: VoiceRoom = {
      channelId: roomChannelId,
      createdAt: this.clock(),
      guildId: change.guildId,
      lobbyChannelId: lobby.channelId,
      ownerId: change.userId,
    };

    this.managedChannels.set(roomChannelId, true);
    await this.repository.createRoom(room);
    rooms.set(roomChannelId, room);
    this.cooldowns.set(cooldownKey, true);

    try {
      await this.platform.moveMember(change.guildId, change.userId, roomChannelId);
    } catch (error) {
      // The member left the lobby before the move; the new room would stay empty forever.
      await this.deleteIfEmpty(change.guildId, roomChannelId);
      throw error;
    }

    return { kind: "room-created", room };
  }

  private runOwnerAction(
    guildId: string,
    actor: RoomActor,
    action: OwnerAction,
  ): Promise<RoomActionResult> {
    return this.mutex.run(guildId, async () => {
      const room = await this.findActorRoom(guildId, actor);

      if (room === undefined) {
        return "not-in-room";
      }

      if (room.ownerId !== actor.userId) {
        return "not-owner";
      }

      return action(room);
    });
  }
}
