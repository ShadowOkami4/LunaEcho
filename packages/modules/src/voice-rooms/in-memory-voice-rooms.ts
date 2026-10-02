import type {
  CreateRoomRequest,
  RoomAccess,
  RoomDetails,
  VoiceRoomPlatform,
} from "./voice-room-platform.js";
import type { SaveLobbyResult, VoiceRoomRepository } from "./voice-room-repository.js";
import type { VoiceStateChange } from "./voice-room-service.js";
import type { VoiceRoom, VoiceRoomLobby } from "./voice-room.js";

export class InMemoryVoiceRoomRepository implements VoiceRoomRepository {
  public readonly lobbies = new Map<string, VoiceRoomLobby>();
  public readonly rooms = new Map<string, VoiceRoom>();
  public queries = 0;

  public createRoom(room: VoiceRoom): Promise<void> {
    this.queries += 1;
    this.rooms.set(room.channelId, room);
    return Promise.resolve();
  }

  public deleteRoom(channelId: string): Promise<void> {
    this.queries += 1;
    this.rooms.delete(channelId);
    return Promise.resolve();
  }

  public listLobbies(guildId: string): Promise<VoiceRoomLobby[]> {
    this.queries += 1;
    return Promise.resolve([...this.lobbies.values()].filter((lobby) => lobby.guildId === guildId));
  }

  public listRooms(guildId: string): Promise<VoiceRoom[]> {
    this.queries += 1;
    return Promise.resolve([...this.rooms.values()].filter((room) => room.guildId === guildId));
  }

  public listRoomGuildIds(): Promise<string[]> {
    this.queries += 1;
    return Promise.resolve([...new Set([...this.rooms.values()].map((room) => room.guildId))]);
  }

  public removeLobby(guildId: string, channelId: string): Promise<boolean> {
    this.queries += 1;
    const lobby = this.lobbies.get(channelId);
    return Promise.resolve(lobby?.guildId === guildId && this.lobbies.delete(channelId));
  }

  public saveLobby(lobby: VoiceRoomLobby, maximumLobbies: number): Promise<SaveLobbyResult> {
    this.queries += 1;

    if (this.lobbies.has(lobby.channelId)) {
      this.lobbies.set(lobby.channelId, lobby);
      return Promise.resolve("updated");
    }

    const guildLobbies = [...this.lobbies.values()].filter(
      (candidate) => candidate.guildId === lobby.guildId,
    );

    if (guildLobbies.length >= maximumLobbies) {
      return Promise.resolve("limit-reached");
    }

    this.lobbies.set(lobby.channelId, lobby);
    return Promise.resolve("created");
  }

  public setRoomOwner(channelId: string, ownerId: string): Promise<void> {
    this.queries += 1;
    const room = this.rooms.get(channelId);

    if (room !== undefined) {
      this.rooms.set(channelId, { ...room, ownerId });
    }

    return Promise.resolve();
  }
}

interface SimulatedChannel {
  details: RoomDetails;
  guildId: string;
  owners: Set<string>;
  rejected: Set<string>;
}

export type SimulatedVoicePlatformOptions = Readonly<{
  /** Simulated Discord API round trip for every write, in milliseconds. */
  apiLatencyMilliseconds?: number;
  /** Receives the voice state updates Discord would send after a move or disconnect. */
  onVoiceStateChange?: (change: VoiceStateChange) => void;
}>;

/**
 * A Discord server simulation for voice rooms: channels, connected members, and the voice
 * events Discord emits. Tests and the load simulation drive it instead of a real gateway.
 */
export class SimulatedVoicePlatform implements VoiceRoomPlatform {
  public apiCalls = 0;
  private readonly channels = new Map<string, SimulatedChannel>();
  private readonly connections = new Map<string, string>();
  /** Indexed by channel so occupancy checks stay constant-time under load. */
  private readonly occupants = new Map<string, Set<string>>();
  private nextChannelNumber = 1;

  public constructor(private readonly options: SimulatedVoicePlatformOptions = {}) {}

  public get channelCount(): number {
    return this.channels.size;
  }

  /** Creates a regular voice channel, such as a lobby. */
  public addChannel(guildId: string, channelId: string, name = channelId): void {
    this.channels.set(channelId, {
      details: { hidden: false, locked: false, name, userLimit: 0 },
      guildId,
      owners: new Set(),
      rejected: new Set(),
    });
  }

  /** A member connects, moves, or disconnects on their own; returns the matching event. */
  public setMemberChannel(
    guildId: string,
    userId: string,
    channelId: string | null,
    displayName = userId,
  ): VoiceStateChange {
    const key = `${guildId}:${userId}`;
    const oldChannelId = this.connections.get(key) ?? null;

    if (oldChannelId !== null) {
      const previous = this.occupants.get(oldChannelId);
      previous?.delete(userId);

      if (previous?.size === 0) {
        this.occupants.delete(oldChannelId);
      }
    }

    if (channelId === null) {
      this.connections.delete(key);
    } else {
      this.connections.set(key, channelId);
      const current = this.occupants.get(channelId) ?? new Set<string>();
      current.add(userId);
      this.occupants.set(channelId, current);
    }

    return { displayName, guildId, newChannelId: channelId, oldChannelId, userId };
  }

  public channelOf(guildId: string, userId: string): string | null {
    return this.connections.get(`${guildId}:${userId}`) ?? null;
  }

  public async createRoom(request: CreateRoomRequest): Promise<string> {
    await this.apiCall();
    const channelId = `room-${this.nextChannelNumber}`;
    this.nextChannelNumber += 1;
    this.channels.set(channelId, {
      details: { hidden: false, locked: false, name: request.name, userLimit: request.userLimit },
      guildId: request.guildId,
      owners: new Set([request.ownerId]),
      rejected: new Set(),
    });
    return channelId;
  }

  public async deleteRoom(_guildId: string, channelId: string): Promise<void> {
    await this.apiCall();
    this.channels.delete(channelId);
  }

  public async disconnectMember(guildId: string, userId: string): Promise<void> {
    await this.apiCall();
    this.emit(this.setMemberChannel(guildId, userId, null));
  }

  public getRoomDetails(_guildId: string, channelId: string): RoomDetails | undefined {
    return this.channels.get(channelId)?.details;
  }

  public async grantOwnerPermissions(
    _guildId: string,
    channelId: string,
    ownerId: string,
  ): Promise<void> {
    await this.apiCall();
    this.channels.get(channelId)?.owners.add(ownerId);
  }

  public ownersOf(channelId: string): readonly string[] {
    return [...(this.channels.get(channelId)?.owners ?? [])];
  }

  public isRejected(channelId: string, userId: string): boolean {
    return this.channels.get(channelId)?.rejected.has(userId) ?? false;
  }

  public async moveMember(guildId: string, userId: string, channelId: string): Promise<void> {
    await this.apiCall();

    // Discord refuses to move a member who is no longer connected to voice.
    if (this.channelOf(guildId, userId) === null) {
      throw new Error("Target user is not connected to voice");
    }

    this.emit(this.setMemberChannel(guildId, userId, channelId));
  }

  public occupantIds(_guildId: string, channelId: string): readonly string[] {
    return [...(this.occupants.get(channelId) ?? [])];
  }

  public async renameRoom(_guildId: string, channelId: string, name: string): Promise<void> {
    await this.apiCall();
    this.updateDetails(channelId, { name });
  }

  public async revokeOwnerPermissions(
    _guildId: string,
    channelId: string,
    ownerId: string,
  ): Promise<void> {
    await this.apiCall();
    this.channels.get(channelId)?.owners.delete(ownerId);
  }

  public roomExists(_guildId: string, channelId: string): boolean {
    return this.channels.has(channelId);
  }

  public async setMemberAccess(
    _guildId: string,
    channelId: string,
    userId: string,
    access: "permit" | "reject",
  ): Promise<void> {
    await this.apiCall();
    const rejected = this.channels.get(channelId)?.rejected;

    if (access === "reject") {
      rejected?.add(userId);
    } else {
      rejected?.delete(userId);
    }
  }

  public async setRoomAccess(
    _guildId: string,
    channelId: string,
    access: Partial<RoomAccess>,
  ): Promise<void> {
    await this.apiCall();
    this.updateDetails(channelId, access);
  }

  public async setUserLimit(_guildId: string, channelId: string, userLimit: number): Promise<void> {
    await this.apiCall();
    this.updateDetails(channelId, { userLimit });
  }

  private async apiCall(): Promise<void> {
    this.apiCalls += 1;
    const latency = this.options.apiLatencyMilliseconds ?? 0;

    if (latency > 0) {
      await new Promise((resolve) => setTimeout(resolve, latency));
    }
  }

  private emit(change: VoiceStateChange): void {
    this.options.onVoiceStateChange?.(change);
  }

  private updateDetails(channelId: string, update: Partial<RoomDetails>): void {
    const channel = this.channels.get(channelId);

    if (channel !== undefined) {
      channel.details = { ...channel.details, ...update };
    }
  }
}
