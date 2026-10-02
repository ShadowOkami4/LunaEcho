import { describe, expect, it } from "vitest";

import {
  roomCreationCooldownMilliseconds,
  VoiceRoomInputError,
  VoiceRoomService,
  type VoiceRoomEvent,
  type VoiceRoomServiceOptions,
  type VoiceStateChange,
} from "../src/index.js";
import { InMemoryVoiceRoomRepository, SimulatedVoicePlatform } from "../src/testing.js";

const guildId = "guild-1";
const lobbyId = "lobby-1";

async function createWorld(options: VoiceRoomServiceOptions = {}) {
  let now = new Date("2026-01-01T00:00:00.000Z").getTime();
  const pending: VoiceStateChange[] = [];
  const repository = new InMemoryVoiceRoomRepository();
  const platform = new SimulatedVoicePlatform({
    onVoiceStateChange: (change) => pending.push(change),
  });
  const service = new VoiceRoomService(repository, platform, {
    clock: () => new Date(now),
    ...options,
  });

  platform.addChannel(guildId, lobbyId, "Join to create");
  platform.addChannel(guildId, "general", "General");
  await service.saveLobby({
    actorId: "admin",
    categoryId: null,
    channelId: lobbyId,
    guildId,
    nameTemplate: "{user}'s Room",
    userLimit: 0,
  });

  /** A member moves on their own; follow-up events Discord would send are processed too. */
  async function move(userId: string, channelId: string | null): Promise<VoiceRoomEvent[]> {
    const events = [
      ...(await service.handleVoiceStateChange(
        platform.setMemberChannel(guildId, userId, channelId, `Name ${userId}`),
      )),
    ];

    for (let change = pending.shift(); change !== undefined; change = pending.shift()) {
      events.push(...(await service.handleVoiceStateChange(change)));
    }

    return events;
  }

  function actor(userId: string) {
    return { channelId: platform.channelOf(guildId, userId), userId };
  }

  return {
    actor,
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
    move,
    platform,
    repository,
    service,
  };
}

describe("VoiceRoomService", () => {
  it("opens a named room when a member joins the lobby and moves them into it", async () => {
    const { move, platform, repository } = await createWorld();

    const events = await move("alice", lobbyId);
    const room = events.find((event) => event.kind === "room-created");

    expect(room).toMatchObject({ room: { lobbyChannelId: lobbyId, ownerId: "alice" } });
    const channelId = room?.kind === "room-created" ? room.room.channelId : "";
    expect(platform.channelOf(guildId, "alice")).toBe(channelId);
    expect(platform.getRoomDetails(guildId, channelId)?.name).toBe("Name alice's Room");
    expect(platform.ownersOf(channelId)).toEqual(["alice"]);
    expect(repository.rooms.has(channelId)).toBe(true);
  });

  it("keeps a room while anyone is inside and deletes it once empty", async () => {
    const { move, platform, repository } = await createWorld();
    await move("alice", lobbyId);
    const roomId = platform.channelOf(guildId, "alice") ?? "";
    await move("bob", roomId);

    await expect(move("alice", "general")).resolves.toEqual([]);
    expect(platform.roomExists(guildId, roomId)).toBe(true);

    await expect(move("bob", null)).resolves.toEqual([{ channelId: roomId, kind: "room-deleted" }]);
    expect(platform.roomExists(guildId, roomId)).toBe(false);
    expect(repository.rooms.size).toBe(0);
  });

  it("returns an owner to their existing room instead of opening a second one", async () => {
    const { move, platform } = await createWorld();
    await move("alice", lobbyId);
    const roomId = platform.channelOf(guildId, "alice") ?? "";
    await move("bob", roomId);

    const events = await move("alice", lobbyId);

    expect(events).toMatchObject([{ kind: "moved-to-own-room", room: { channelId: roomId } }]);
    expect(platform.channelOf(guildId, "alice")).toBe(roomId);
  });

  it("refuses a new room during the cooldown and allows it afterwards", async () => {
    const { advance, move } = await createWorld();
    await move("alice", lobbyId);
    await move("alice", null);

    await expect(move("alice", lobbyId)).resolves.toEqual([
      { kind: "creation-refused", reason: "cooldown" },
    ]);

    advance(roomCreationCooldownMilliseconds);
    await move("alice", null);
    await expect(move("alice", lobbyId)).resolves.toMatchObject([{ kind: "room-created" }]);
  });

  it("stops at the guild's room limit", async () => {
    const { move } = await createWorld({ resolveRoomLimit: () => Promise.resolve(1) });

    await move("alice", lobbyId);
    await expect(move("bob", lobbyId)).resolves.toEqual([
      { kind: "creation-refused", reason: "limit-reached" },
    ]);
  });

  it("opens no rooms while the module is off but still cleans up existing ones", async () => {
    let enabled = true;
    const { move, platform } = await createWorld({
      canCreateRooms: () => Promise.resolve(enabled),
    });
    await move("alice", lobbyId);
    const roomId = platform.channelOf(guildId, "alice") ?? "";
    enabled = false;

    await expect(move("bob", lobbyId)).resolves.toEqual([
      { kind: "creation-refused", reason: "module-off" },
    ]);
    await expect(move("alice", null)).resolves.toEqual([
      { channelId: roomId, kind: "room-deleted" },
    ]);
  });

  it("deletes the new room when the member left the lobby before being moved", async () => {
    const repository = new InMemoryVoiceRoomRepository();
    const platform = new SimulatedVoicePlatform();
    const service = new VoiceRoomService(repository, platform);
    platform.addChannel(guildId, lobbyId);
    await service.saveLobby({
      actorId: "admin",
      categoryId: null,
      channelId: lobbyId,
      guildId,
      nameTemplate: "{user}",
      userLimit: 0,
    });
    const join = platform.setMemberChannel(guildId, "alice", lobbyId);
    platform.setMemberChannel(guildId, "alice", null);

    await expect(service.handleVoiceStateChange(join)).rejects.toThrow("not connected");
    expect(repository.rooms.size).toBe(0);
    expect(platform.channelCount).toBe(1);
  });

  it("opens exactly one room per member when many join at once", async () => {
    const { platform, repository, service } = await createWorld();
    const members = Array.from({ length: 50 }, (_, index) => `member-${index}`);
    const pendingMoves: VoiceStateChange[] = [];

    await Promise.all(
      members.map((userId) =>
        service.handleVoiceStateChange(platform.setMemberChannel(guildId, userId, lobbyId)),
      ),
    );
    pendingMoves.push(
      ...members.map((userId) => ({
        displayName: userId,
        guildId,
        newChannelId: platform.channelOf(guildId, userId),
        oldChannelId: lobbyId,
        userId,
      })),
    );
    await Promise.all(pendingMoves.map((change) => service.handleVoiceStateChange(change)));

    expect(repository.rooms.size).toBe(50);
    expect(new Set(members.map((userId) => platform.channelOf(guildId, userId))).size).toBe(50);
  });

  describe("owner controls", () => {
    it("lets only the owner rename, limit, lock, and hide the room", async () => {
      const { actor, move, platform, service } = await createWorld();
      await move("alice", lobbyId);
      const roomId = platform.channelOf(guildId, "alice") ?? "";
      await move("bob", roomId);

      await expect(service.renameRoom(guildId, actor("bob"), "Mine now")).resolves.toBe(
        "not-owner",
      );
      await expect(service.renameRoom(guildId, actor("alice"), "  Study  room ")).resolves.toBe(
        "done",
      );
      await service.setUserLimit(guildId, actor("alice"), 5);
      await service.setLocked(guildId, actor("alice"), true);
      await service.setHidden(guildId, actor("alice"), true);

      expect(platform.getRoomDetails(guildId, roomId)).toEqual({
        hidden: true,
        locked: true,
        name: "Study room",
        userLimit: 5,
      });
      await expect(service.renameRoom(guildId, actor("carol"), "x")).resolves.toBe("not-in-room");
      expect(() => service.setUserLimit(guildId, actor("alice"), 100)).toThrow(VoiceRoomInputError);
    });

    it("rejects and disconnects a member, and kicks only members inside", async () => {
      const { actor, move, platform, service } = await createWorld();
      await move("alice", lobbyId);
      const roomId = platform.channelOf(guildId, "alice") ?? "";
      await move("bob", roomId);

      await expect(service.kickMember(guildId, actor("alice"), "carol")).resolves.toBe(
        "invalid-target",
      );
      await expect(service.rejectMember(guildId, actor("alice"), "bob")).resolves.toBe("done");
      expect(platform.isRejected(roomId, "bob")).toBe(true);
      expect(platform.channelOf(guildId, "bob")).toBeNull();

      await expect(service.permitMember(guildId, actor("alice"), "bob")).resolves.toBe("done");
      expect(platform.isRejected(roomId, "bob")).toBe(false);
    });

    it("transfers ownership and lets members claim an abandoned room", async () => {
      const { actor, move, platform, repository, service } = await createWorld();
      await move("alice", lobbyId);
      const roomId = platform.channelOf(guildId, "alice") ?? "";
      await move("bob", roomId);
      await move("carol", roomId);

      await expect(service.claimRoom(guildId, actor("bob"))).resolves.toBe("owner-present");
      await expect(service.transferRoom(guildId, actor("alice"), "bob")).resolves.toBe("done");
      expect(platform.ownersOf(roomId)).toEqual(["bob"]);
      expect(repository.rooms.get(roomId)?.ownerId).toBe("bob");

      await move("bob", null);
      await expect(service.claimRoom(guildId, actor("carol"))).resolves.toBe("done");
      await expect(service.getRoomInfo(guildId, actor("carol"))).resolves.toMatchObject({
        occupantCount: 2,
        room: { ownerId: "carol" },
      });
    });
  });

  describe("maintenance", () => {
    it("cleans up rooms that emptied or vanished while offline", async () => {
      const { move, platform, repository, service } = await createWorld();
      await move("alice", lobbyId);
      await move("bob", lobbyId);
      const aliceRoom = platform.channelOf(guildId, "alice") ?? "";
      const bobRoom = platform.channelOf(guildId, "bob") ?? "";

      // While offline: Alice's channel is deleted by hand and Bob disconnects unnoticed.
      await platform.deleteRoom(guildId, aliceRoom);
      platform.setMemberChannel(guildId, "bob", null);

      await expect(service.reconcile(() => false)).resolves.toBe(0);
      await expect(service.reconcile(() => true)).resolves.toBe(2);
      expect(repository.rooms.size).toBe(0);
      expect(platform.roomExists(guildId, bobRoom)).toBe(false);
    });

    it("forgets lobbies and rooms deleted outside LunaEcho", async () => {
      const { move, platform, repository, service } = await createWorld();
      await move("alice", lobbyId);
      const roomId = platform.channelOf(guildId, "alice") ?? "";

      await service.handleChannelDeleted(guildId, roomId);
      await service.handleChannelDeleted(guildId, lobbyId);

      expect(repository.rooms.size).toBe(0);
      await expect(service.listLobbies(guildId)).resolves.toEqual([]);
    });
  });
});
