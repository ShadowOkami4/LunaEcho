import type { DatabaseConnection } from "@lunaecho/db";
import { createTestDatabase, resetTestDatabase } from "@lunaecho/db/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { BotTaskQueue } from "../src/index.js";

describe("BotTaskQueue", () => {
  let connection: DatabaseConnection;
  let queue: BotTaskQueue;

  beforeAll(async () => {
    connection = await createTestDatabase();
    queue = new BotTaskQueue(connection.db);
  });

  afterEach(async () => {
    await resetTestDatabase(connection.db);
  });

  afterAll(async () => {
    await connection.close();
  });

  it("hands out each task once, oldest first", async () => {
    await queue.enqueue("settings-changed", "guild-1", { module: "moderation" });
    await queue.enqueue("post-role-menu", "guild-1", { menuId: "menu-1" });
    await queue.enqueue("settings-changed", "guild-2", { module: "music" });

    const first = await queue.claim(2);
    const second = await queue.claim(2);

    expect(first.map((task) => task.kind)).toEqual(["settings-changed", "post-role-menu"]);
    expect(first[1]?.payload).toEqual({ menuId: "menu-1" });
    expect(second.map((task) => task.guildId)).toEqual(["guild-2"]);
    await expect(queue.claim(5)).resolves.toEqual([]);
  });

  it("offers a claimed task again when it was never completed", async () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    await queue.enqueue("post-verification-panel", "guild-1", {});

    const [task] = await queue.claim(1, now);
    await expect(queue.claim(1, new Date(now.getTime() + 30_000))).resolves.toEqual([]);

    const [retry] = await queue.claim(1, new Date(now.getTime() + 61_000));
    expect(retry?.id).toBe(task?.id);
    expect(retry?.attempts).toBe(2);
  });

  it("forgets completed tasks and prunes old ones", async () => {
    await queue.enqueue("settings-changed", "guild-1", { module: "logs" });
    const [task] = await queue.claim(1);

    await queue.complete(task?.id ?? 0, new Date("2026-01-01T00:00:00.000Z"));
    await expect(queue.pending()).resolves.toBe(0);
    await expect(queue.claim(1, new Date("2026-01-02T00:00:00.000Z"))).resolves.toEqual([]);

    await queue.prune(new Date("2026-01-03T00:00:00.000Z"));
    await queue.enqueue("settings-changed", "guild-1", { module: "logs" });
    await expect(queue.pending()).resolves.toBe(1);
  });
});
