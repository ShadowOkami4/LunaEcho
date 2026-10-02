import type { DatabaseConnection } from "@lunaecho/db";
import { createTestDatabase, resetTestDatabase } from "@lunaecho/db/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { DrizzleModerationCaseRepository } from "../src/index.js";

const createdAt = new Date("2026-01-01T00:00:00.000Z");
const warning = {
  action: "warn",
  createdAt,
  guildId: "guild-1",
  moderatorUserId: "admin-1",
  reason: "Repeated rule violation",
  targetUserId: "user-1",
} as const;
const keepEveryCase = null;

describe("DrizzleModerationCaseRepository", () => {
  let connection: DatabaseConnection;
  let repository: DrizzleModerationCaseRepository;

  beforeAll(async () => {
    connection = await createTestDatabase();
    repository = new DrizzleModerationCaseRepository(connection.db);
  });

  afterEach(async () => {
    await resetTestDatabase(connection.db);
  });

  afterAll(async () => {
    await connection.close();
  });

  it("allocates sequential case numbers independently per guild", async () => {
    await expect(repository.createPending(warning, keepEveryCase)).resolves.toMatchObject({
      caseNumber: 1,
    });
    await expect(repository.createPending(warning, keepEveryCase)).resolves.toMatchObject({
      caseNumber: 2,
    });
    await expect(
      repository.createPending({ ...warning, guildId: "guild-2" }, keepEveryCase),
    ).resolves.toMatchObject({ caseNumber: 1 });
  });

  it("returns stored cases with their original timestamps", async () => {
    const created = await repository.createPending(
      {
        action: "purge",
        createdAt,
        guildId: "guild-1",
        moderatorUserId: "admin-1",
        reason: "Cleanup",
      },
      keepEveryCase,
    );

    await expect(repository.findByCaseNumber("guild-1", created.caseNumber)).resolves.toEqual({
      action: "purge",
      caseNumber: 1,
      completedAt: null,
      createdAt,
      durationSeconds: null,
      failureCode: null,
      guildId: "guild-1",
      moderatorUserId: "admin-1",
      reason: "Cleanup",
      status: "pending",
      targetUserId: null,
    });
    await expect(repository.findByCaseNumber("guild-1", 99)).resolves.toBeUndefined();
  });

  it("persists completed and failed states and target history", async () => {
    const first = await repository.createPending(
      { ...warning, action: "timeout", durationSeconds: 600, reason: "Mention spam" },
      keepEveryCase,
    );
    const second = await repository.createPending(
      { ...warning, reason: "Attachment spam" },
      keepEveryCase,
    );

    await repository.markCompleted("guild-1", first.caseNumber, createdAt);
    await repository.markFailed("guild-1", second.caseNumber, "discord-action-failed", createdAt);

    await expect(repository.listForTarget("guild-1", "user-1", 10)).resolves.toMatchObject([
      { caseNumber: 2, failureCode: "discord-action-failed", status: "failed" },
      { caseNumber: 1, status: "completed" },
    ]);
    await expect(repository.listRecent("guild-1", 1)).resolves.toMatchObject([{ caseNumber: 2 }]);
  });

  it("rejects finishing a case that is no longer pending", async () => {
    const created = await repository.createPending(
      { ...warning, action: "kick", reason: "Raid" },
      keepEveryCase,
    );

    await repository.markCompleted("guild-1", created.caseNumber, createdAt);
    await expect(
      repository.markCompleted("guild-1", created.caseNumber, createdAt),
    ).rejects.toThrow("Pending moderation case #1 was not found");
  });

  it("keeps only the newest cases of a guild when a storage limit applies", async () => {
    for (let index = 0; index < 5; index += 1) {
      await repository.createPending(warning, 3);
    }
    await repository.createPending({ ...warning, guildId: "guild-2" }, 3);

    const kept = await repository.listRecent("guild-1", 10);
    expect(kept.map((moderationCase) => moderationCase.caseNumber)).toEqual([5, 4, 3]);
    await expect(repository.listRecent("guild-2", 10)).resolves.toHaveLength(1);

    // Numbers of deleted cases are not handed out again.
    await expect(repository.createPending(warning, 3)).resolves.toMatchObject({ caseNumber: 6 });
  });

  it("keeps every case without a storage limit", async () => {
    for (let index = 0; index < 5; index += 1) {
      await repository.createPending(warning, keepEveryCase);
    }

    await expect(repository.listRecent("guild-1", 10)).resolves.toHaveLength(5);
  });
});
