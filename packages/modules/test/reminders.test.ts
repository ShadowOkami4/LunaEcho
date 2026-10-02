import type { DatabaseConnection } from "@lunaecho/db";
import { createTestDatabase, resetTestDatabase } from "@lunaecho/db/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { maximumRemindersPerMember, parseDuration, ReminderService } from "../src/index.js";

describe("parseDuration", () => {
  it("reads single and combined units", () => {
    expect(parseDuration("10m")).toBe(600_000);
    expect(parseDuration("1h30m")).toBe(5_400_000);
    expect(parseDuration("1w 2d")).toBe(777_600_000);
    expect(parseDuration(" 2H ")).toBe(7_200_000);
  });

  it("rejects anything else", () => {
    for (const input of ["", "10", "m10", "1.5h", "0m", "tomorrow", "10m later"]) {
      expect(parseDuration(input)).toBeUndefined();
    }
  });
});

describe("ReminderService", () => {
  let connection: DatabaseConnection;
  let now = new Date("2026-01-01T00:00:00.000Z");
  let service: ReminderService;
  const base = { channelId: "channel-1", guildId: "guild-1", userId: "alice" } as const;

  beforeAll(async () => {
    connection = await createTestDatabase();
    service = new ReminderService(connection.db, () => now);
  });

  afterEach(async () => {
    now = new Date("2026-01-01T00:00:00.000Z");
    await resetTestDatabase(connection.db);
  });

  afterAll(async () => {
    await connection.close();
  });

  it("creates, lists, and delivers reminders when due", async () => {
    await expect(
      service.create({ ...base, delayMilliseconds: 600_000, text: "  Stretch  " }),
    ).resolves.toMatchObject({ kind: "created", reminder: { text: "Stretch" } });
    await service.create({ ...base, delayMilliseconds: 60_000, text: "Water" });

    await expect(service.list("guild-1", "alice")).resolves.toMatchObject([
      { text: "Water" },
      { text: "Stretch" },
    ]);
    await expect(service.takeDue(10, new Date("2026-01-01T00:05:00.000Z"))).resolves.toMatchObject([
      { text: "Water" },
    ]);
    await expect(service.takeDue(10, new Date("2026-01-01T00:05:00.000Z"))).resolves.toEqual([]);
    await expect(service.list("guild-1", "alice")).resolves.toHaveLength(1);
  });

  it("validates text, delay, and the per-member limit", async () => {
    await expect(
      service.create({ ...base, delayMilliseconds: 600_000, text: "  " }),
    ).resolves.toEqual({
      kind: "invalid-text",
    });
    await expect(service.create({ ...base, delayMilliseconds: 1_000, text: "x" })).resolves.toEqual(
      {
        kind: "invalid-delay",
      },
    );

    for (let index = 0; index < maximumRemindersPerMember; index += 1) {
      await service.create({ ...base, delayMilliseconds: 600_000, text: `Reminder ${index}` });
    }

    await expect(
      service.create({ ...base, delayMilliseconds: 600_000, text: "one more" }),
    ).resolves.toEqual({
      kind: "too-many",
    });
    await expect(
      service.create({ ...base, delayMilliseconds: 600_000, text: "bob's own", userId: "bob" }),
    ).resolves.toMatchObject({ kind: "created" });
  });

  it("cancels only the member's own reminders", async () => {
    const own = await service.create({ ...base, delayMilliseconds: 600_000, text: "mine" });
    const other = await service.create({
      ...base,
      delayMilliseconds: 600_000,
      text: "bob",
      userId: "bob",
    });
    const ids = [own, other].map((result) => (result.kind === "created" ? result.reminder.id : 0));

    await expect(service.cancel("guild-1", "alice", ids)).resolves.toBe(1);
    await expect(service.list("guild-1", "bob")).resolves.toHaveLength(1);
  });
});
