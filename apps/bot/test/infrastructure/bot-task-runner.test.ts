import type { BotTask, BotTaskQueue } from "@lunaecho/modules";
import pino from "pino";
import { describe, expect, it, vi } from "vitest";

import { BotTaskRunner } from "../../src/infrastructure/tasks/bot-task-runner.js";

function createQueue(tasks: BotTask[]) {
  const completed: number[] = [];
  const failed: [number, string][] = [];
  const queue = {
    claim: vi.fn(() => Promise.resolve(tasks.splice(0))),
    complete: vi.fn((id: number) => {
      completed.push(id);
      return Promise.resolve();
    }),
    fail: vi.fn((id: number, error: string) => {
      failed.push([id, error]);
      return Promise.resolve();
    }),
    prune: vi.fn(() => Promise.resolve()),
  } as unknown as BotTaskQueue;

  return { completed, failed, queue };
}

function task(id: number, kind: string): BotTask {
  return { attempts: 1, guildId: "guild-1", id, kind, payload: {} };
}

describe("BotTaskRunner", () => {
  it("completes handled tasks and records failures for the rest", async () => {
    const { completed, failed, queue } = createQueue([
      task(1, "settings-changed"),
      task(2, "post-panel"),
      task(3, "unknown"),
    ]);
    const seen: string[] = [];
    const runner = new BotTaskRunner(
      queue,
      new Map([
        [
          "settings-changed",
          (handled: BotTask) => {
            seen.push(handled.guildId);
            return Promise.resolve();
          },
        ],
        ["post-panel", () => Promise.reject(new Error("Missing Access"))],
      ]),
      pino({ level: "silent" }),
    );

    await expect(runner.poll()).resolves.toBe(3);

    expect(seen).toEqual(["guild-1"]);
    expect(completed).toEqual([1]);
    expect(failed).toEqual([
      [2, "Missing Access"],
      [3, "No handler for task kind 'unknown'"],
    ]);
  });
});
