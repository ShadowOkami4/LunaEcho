import type { DatabaseConnection } from "@lunaecho/db";
import { createTestDatabase, resetTestDatabase } from "@lunaecho/db/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { DrizzleVoiceRoomRepository, type VoiceRoomLobby } from "../src/index.js";

const createdAt = new Date("2026-01-01T00:00:00.000Z");

function lobby(channelId: string, guildId = "guild-1"): VoiceRoomLobby {
  return {
    categoryId: "category-1",
    channelId,
    createdAt,
    createdBy: "admin-1",
    guildId,
    nameTemplate: "{user}'s Room",
    userLimit: 4,
  };
}

describe("DrizzleVoiceRoomRepository", () => {
  let connection: DatabaseConnection;
  let repository: DrizzleVoiceRoomRepository;

  beforeAll(async () => {
    connection = await createTestDatabase();
    repository = new DrizzleVoiceRoomRepository(connection.db);
  });

  afterEach(async () => {
    await resetTestDatabase(connection.db);
  });

  afterAll(async () => {
    await connection.close();
  });

  it("creates, updates, limits, and removes lobbies per guild", async () => {
    await expect(repository.saveLobby(lobby("lobby-1"), 2)).resolves.toBe("created");
    await expect(repository.saveLobby({ ...lobby("lobby-1"), userLimit: 8 }, 2)).resolves.toBe(
      "updated",
    );
    await expect(repository.saveLobby(lobby("lobby-2"), 2)).resolves.toBe("created");
    await expect(repository.saveLobby(lobby("lobby-3"), 2)).resolves.toBe("limit-reached");
    await expect(repository.saveLobby(lobby("lobby-9", "guild-2"), 2)).resolves.toBe("created");

    await expect(repository.listLobbies("guild-1")).resolves.toMatchObject([
      { channelId: "lobby-1", userLimit: 8 },
      { channelId: "lobby-2" },
    ]);
    await expect(repository.removeLobby("guild-1", "lobby-1")).resolves.toBe(true);
    await expect(repository.removeLobby("guild-1", "lobby-1")).resolves.toBe(false);
  });

  it("stores rooms, changes their owner, and lists guilds with rooms", async () => {
    const room = {
      channelId: "room-1",
      createdAt,
      guildId: "guild-1",
      lobbyChannelId: "lobby-1",
      ownerId: "alice",
    };

    await repository.createRoom(room);
    await repository.createRoom({ ...room, channelId: "room-2", guildId: "guild-2" });
    await repository.setRoomOwner("room-1", "bob");

    await expect(repository.listRooms("guild-1")).resolves.toEqual([{ ...room, ownerId: "bob" }]);
    await expect(repository.listRoomGuildIds()).resolves.toEqual(
      expect.arrayContaining(["guild-1", "guild-2"]),
    );

    await repository.deleteRoom("room-1");
    await expect(repository.listRooms("guild-1")).resolves.toEqual([]);
  });
});
