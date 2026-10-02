import type { DatabaseConnection } from "@lunaecho/db";
import { createTestDatabase, resetTestDatabase } from "@lunaecho/db/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createAutomodProfileRules } from "../src/index.js";
import { DrizzleModerationSettingsRepository } from "../src/index.js";

describe("DrizzleModerationSettingsRepository", () => {
  let connection: DatabaseConnection;
  let repository: DrizzleModerationSettingsRepository;

  beforeAll(async () => {
    connection = await createTestDatabase();
    repository = new DrizzleModerationSettingsRepository(connection.db);
  });

  afterEach(async () => {
    await resetTestDatabase(connection.db);
  });

  afterAll(async () => {
    await connection.close();
  });

  it("persists settings and banned words independently per guild", async () => {
    const createdAt = new Date("2026-01-01T00:00:00.000Z");

    await expect(
      repository.addBannedWord(
        {
          createdAt,
          createdBy: "admin-1",
          displayValue: "Bad Word",
          guildId: "guild-1",
          normalizedValue: "bad word",
        },
        100,
      ),
    ).resolves.toBe("added");
    await expect(repository.toggleBannedWords("guild-1", createdAt)).resolves.toBe(true);

    await expect(repository.getByGuildId("guild-1")).resolves.toMatchObject({
      bannedWords: [{ createdAt, displayValue: "Bad Word", normalizedValue: "bad word" }],
      bannedWordsEnabled: true,
      guildId: "guild-1",
    });
    await expect(repository.getByGuildId("guild-2")).resolves.toMatchObject({
      automodProfile: "off",
      bannedWords: [],
      bannedWordsEnabled: false,
      dmNotificationsEnabled: true,
      guildId: "guild-2",
      staffExempt: true,
    });
  });

  it("sorts banned words without regard to letter case", async () => {
    const createdAt = new Date("2026-01-01T00:00:00.000Z");

    for (const displayValue of ["beta", "Alpha", "Charlie"]) {
      await repository.addBannedWord(
        {
          createdAt,
          createdBy: "admin-1",
          displayValue,
          guildId: "guild-1",
          normalizedValue: displayValue.toLowerCase(),
        },
        100,
      );
    }

    const settings = await repository.getByGuildId("guild-1");
    expect(settings.bannedWords.map((word) => word.displayValue)).toEqual([
      "Alpha",
      "beta",
      "Charlie",
    ]);
  });

  it("atomically handles duplicates, limits, and removals", async () => {
    const word = {
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      createdBy: "admin-1",
      displayValue: "First",
      guildId: "guild-1",
      normalizedValue: "first",
    } as const;

    await expect(repository.addBannedWord(word, 1)).resolves.toBe("added");
    await expect(repository.addBannedWord(word, 1)).resolves.toBe("already-exists");
    await expect(
      repository.addBannedWord({ ...word, displayValue: "Second", normalizedValue: "second" }, 1),
    ).resolves.toBe("limit-reached");
    await expect(
      repository.removeBannedWord("guild-1", "first", new Date("2026-01-02T00:00:00.000Z")),
    ).resolves.toBe(true);
    await expect(
      repository.removeBannedWord("guild-1", "first", new Date("2026-01-02T00:00:00.000Z")),
    ).resolves.toBe(false);
  });

  it("stores independent AutoMod toggles and response policies per guild", async () => {
    await expect(
      repository.toggleAutomodRule(
        "guild-1",
        "mention-spam",
        "admin-1",
        new Date("2026-01-01T00:00:00.000Z"),
      ),
    ).resolves.toMatchObject({ action: "delete-and-warn", enabled: true });
    await expect(
      repository.setAutomodRuleAction(
        "guild-1",
        "mention-spam",
        "delete-and-timeout",
        "admin-1",
        new Date("2026-01-01T00:01:00.000Z"),
      ),
    ).resolves.toMatchObject({ action: "delete-and-timeout", enabled: true });
    await expect(
      repository.toggleAutomodRule(
        "guild-1",
        "mention-spam",
        "admin-1",
        new Date("2026-01-01T00:02:00.000Z"),
      ),
    ).resolves.toMatchObject({ action: "delete-and-timeout", enabled: false });
    await repository.toggleAutomodRule(
      "guild-1",
      "mention-spam",
      "admin-1",
      new Date("2026-01-01T00:03:00.000Z"),
    );

    const guildOne = await repository.getByGuildId("guild-1");
    const guildTwo = await repository.getByGuildId("guild-2");
    expect(guildOne.automodRules.find((rule) => rule.kind === "mention-spam")).toMatchObject({
      action: "delete-and-timeout",
      enabled: true,
    });
    expect(guildTwo.automodRules.every((rule) => !rule.enabled)).toBe(true);
  });

  it("atomically applies profiles and marks manual tuning as custom", async () => {
    const timestamp = new Date("2026-01-01T00:00:00.000Z");
    const strictRules = createAutomodProfileRules("strict");
    await repository.applyAutomodProfile("guild-1", "strict", strictRules, "admin-1", timestamp);
    await expect(repository.getByGuildId("guild-1")).resolves.toMatchObject({
      automodProfile: "strict",
      automodRules: strictRules,
    });

    const floodRule = strictRules.find((rule) => rule.kind === "message-flood");
    await expect(
      repository.setAutomodRuleThreshold(
        "guild-1",
        "message-flood",
        { secondaryLimit: null, triggerLimit: 6, windowSeconds: 10 },
        "admin-1",
        timestamp,
      ),
    ).resolves.toMatchObject({
      action: floodRule?.action,
      enabled: floodRule?.enabled,
      threshold: { triggerLimit: 6, windowSeconds: 10 },
    });
    await expect(
      repository.setAutomodRuleTimeout("guild-1", "message-flood", 3_600, "admin-1", timestamp),
    ).resolves.toMatchObject({
      threshold: { triggerLimit: 6, windowSeconds: 10 },
      timeoutSeconds: 3_600,
    });
    await expect(repository.getByGuildId("guild-1")).resolves.toMatchObject({
      automodProfile: "custom",
    });
  });

  it("persists exception and notification controls with limits", async () => {
    const timestamp = new Date("2026-01-01T00:00:00.000Z");

    await expect(
      repository.toggleExemptChannel("guild-1", "channel-1", "admin-1", 1, timestamp),
    ).resolves.toBe("added");
    await expect(
      repository.toggleExemptChannel("guild-1", "channel-2", "admin-1", 1, timestamp),
    ).resolves.toBe("limit-reached");
    await expect(
      repository.toggleExemptRole("guild-1", "role-1", "admin-1", 1, timestamp),
    ).resolves.toBe("added");
    await expect(repository.toggleStaffExempt("guild-1", timestamp)).resolves.toBe(false);
    await expect(repository.toggleDmNotifications("guild-1", timestamp)).resolves.toBe(false);
    await expect(repository.getByGuildId("guild-1")).resolves.toMatchObject({
      dmNotificationsEnabled: false,
      exemptChannelIds: ["channel-1"],
      exemptRoleIds: ["role-1"],
      staffExempt: false,
    });

    await expect(
      repository.toggleExemptChannel("guild-1", "channel-1", "admin-1", 1, timestamp),
    ).resolves.toBe("removed");
    await expect(repository.toggleStaffExempt("guild-1", timestamp)).resolves.toBe(true);
    await expect(repository.getByGuildId("guild-1")).resolves.toMatchObject({
      exemptChannelIds: [],
      exemptRoleIds: ["role-1"],
      staffExempt: true,
    });
  });
});
