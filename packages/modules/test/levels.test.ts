import type { DatabaseConnection } from "@lunaecho/db";
import { createTestDatabase, resetTestDatabase } from "@lunaecho/db/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  levelFromXp,
  LevelService,
  LevelSettingsInputError,
  xpForNextLevel,
  type LevelSettings,
} from "../src/index.js";

const guildId = "guild-1";
const message = { channelId: "general", guildId, roleIds: [], userId: "alice" } as const;

describe("level curve", () => {
  it("needs 100 XP for level 1 and more for every level after", () => {
    expect(xpForNextLevel(0)).toBe(100);
    expect(xpForNextLevel(1)).toBe(155);
    expect(levelFromXp(99)).toEqual({ level: 0, remainder: 99 });
    expect(levelFromXp(100)).toEqual({ level: 1, remainder: 0 });
    expect(levelFromXp(255)).toEqual({ level: 2, remainder: 0 });
  });
});

describe("LevelService", () => {
  let connection: DatabaseConnection;
  let now = 0;
  let service: LevelService;

  beforeAll(async () => {
    connection = await createTestDatabase();
  });

  afterEach(async () => {
    await resetTestDatabase(connection.db);
  });

  afterAll(async () => {
    await connection.close();
  });

  async function setup(overrides: Partial<LevelSettings> = {}) {
    now = new Date("2026-01-01T00:00:00.000Z").getTime();
    // Always the highest roll, so every message earns exactly the maximum.
    service = new LevelService(
      connection.db,
      () => new Date(now),
      () => 0.999,
    );
    await service.saveSettings(
      { ...(await service.getSettings(guildId)), messageXpMax: 50, messageXpMin: 50, ...overrides },
      "admin",
    );
  }

  it("awards message XP once per cooldown and reports level-ups", async () => {
    await setup();

    await expect(service.awardMessageXp(message)).resolves.toBeUndefined();
    await expect(service.awardMessageXp(message)).resolves.toBeUndefined();
    expect((await service.getRank(guildId, "alice")).totalXp).toBe(50);

    now += 60_000;
    await expect(service.awardMessageXp(message)).resolves.toMatchObject({
      newLevel: 1,
      previousLevel: 0,
    });
    await expect(service.getRank(guildId, "alice")).resolves.toEqual({
      level: 1,
      progress: { current: 0, needed: 155 },
      rank: 1,
      totalXp: 100,
      userId: "alice",
    });
  });

  it("skips ignored channels and roles", async () => {
    await setup({ ignoredChannelIds: ["spam"], ignoredRoleIds: ["muted"] });

    await service.awardMessageXp({ ...message, channelId: "spam" });
    await service.awardMessageXp({ ...message, roleIds: ["muted"] });

    expect((await service.getRank(guildId, "alice")).rank).toBeUndefined();
  });

  it("grants every passed reward when rewards stack", async () => {
    await setup({ messageXpMax: 300, messageXpMin: 300 });
    await service.setReward(guildId, 1, "role-1");
    await service.setReward(guildId, 2, "role-2");
    await service.setReward(guildId, 5, "role-5");

    await expect(service.awardMessageXp(message)).resolves.toMatchObject({
      grantRoleIds: ["role-1", "role-2"],
      newLevel: 2,
      revokeRoleIds: [],
    });
  });

  it("keeps only the highest reward when rewards do not stack", async () => {
    await setup({ messageXpMax: 300, messageXpMin: 300, stackRewards: false });
    await service.setReward(guildId, 1, "role-1");
    await service.setReward(guildId, 2, "role-2");

    await expect(service.awardMessageXp(message)).resolves.toMatchObject({
      grantRoleIds: ["role-2"],
      revokeRoleIds: ["role-1"],
    });
  });

  it("awards voice minutes and ranks the leaderboard", async () => {
    await setup();
    await service.awardVoiceMinute(guildId, ["alice", "bob"]);
    await service.awardVoiceMinute(guildId, ["bob"]);

    await expect(service.leaderboard(guildId, 10)).resolves.toMatchObject([
      { position: 1, totalXp: 20, userId: "bob" },
      { position: 2, totalXp: 10, userId: "alice" },
    ]);
    expect((await service.getRank(guildId, "alice")).rank).toBe(2);
    await expect(service.countMembers(guildId)).resolves.toBe(2);
  });

  it("validates settings and reward levels", async () => {
    await setup();
    const settings = await service.getSettings(guildId);

    await expect(
      service.saveSettings({ ...settings, messageXpMax: 1, messageXpMin: 10 }, "admin"),
    ).rejects.toBeInstanceOf(LevelSettingsInputError);
    await expect(
      service.saveSettings(
        { ...settings, announceChannelId: null, announceMode: "channel" },
        "admin",
      ),
    ).rejects.toBeInstanceOf(LevelSettingsInputError);
    await expect(service.setReward(guildId, 0, "role")).rejects.toBeInstanceOf(
      LevelSettingsInputError,
    );
  });
});
