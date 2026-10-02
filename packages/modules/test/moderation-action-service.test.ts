import pino from "pino";
import { describe, expect, it, vi } from "vitest";

import {
  ModerationActionExecutionError,
  ModerationActionService,
  type StoredCaseLimitResolver,
} from "../src/index.js";
import type { ModerationCaseRepository } from "../src/index.js";
import { createTestModerationActionService } from "../src/testing.js";

const request = {
  action: "warn",
  guildId: "guild-1",
  moderatorUserId: "admin-1",
  reason: "Repeated spam",
  targetUserId: "user-1",
} as const;

describe("ModerationActionService", () => {
  it("completes an action and makes it available in case history", async () => {
    const service = createTestModerationActionService();
    const operation = vi.fn().mockResolvedValue("done");

    await expect(service.execute(request, operation)).resolves.toMatchObject({
      moderationCase: { caseNumber: 1, status: "completed" },
      result: "done",
    });
    await expect(service.findCase("guild-1", 1)).resolves.toMatchObject({
      reason: "Repeated spam",
      status: "completed",
    });
  });

  it("marks the case failed when the Discord operation rejects", async () => {
    const service = createTestModerationActionService();

    await expect(
      service.execute(request, () => Promise.reject(new Error("Discord rejected action"))),
    ).rejects.toBeInstanceOf(ModerationActionExecutionError);
    await expect(service.findCase("guild-1", 1)).resolves.toMatchObject({
      failureCode: "discord-action-failed",
      status: "failed",
    });
  });

  it("stores each case under the guild's storage limit", async () => {
    const createPending = vi.fn<ModerationCaseRepository["createPending"]>().mockResolvedValue({
      ...request,
      caseNumber: 1,
      completedAt: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      durationSeconds: null,
      failureCode: null,
      status: "pending",
    });
    const repository: ModerationCaseRepository = {
      createPending,
      findByCaseNumber: vi.fn<ModerationCaseRepository["findByCaseNumber"]>(),
      listForTarget: vi.fn<ModerationCaseRepository["listForTarget"]>(),
      listRecent: vi.fn<ModerationCaseRepository["listRecent"]>(),
      markCompleted: vi.fn<ModerationCaseRepository["markCompleted"]>().mockResolvedValue(),
      markFailed: vi.fn<ModerationCaseRepository["markFailed"]>(),
    };
    const resolveLimit = vi.fn<StoredCaseLimitResolver>().mockResolvedValue(12_000);
    const service = new ModerationActionService(
      repository,
      pino({ level: "silent" }),
      () => new Date("2026-01-01T00:00:00.000Z"),
      resolveLimit,
    );

    await service.execute(request, () => Promise.resolve());

    expect(resolveLimit).toHaveBeenCalledWith("guild-1");
    expect(createPending).toHaveBeenCalledWith(
      expect.objectContaining({ guildId: "guild-1" }),
      12_000,
    );
  });
});
