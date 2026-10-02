import { describe, expect, it } from "vitest";

import { KeyedMutex } from "../src/index.js";

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

describe("KeyedMutex", () => {
  it("runs tasks for one key strictly in order", async () => {
    const mutex = new KeyedMutex<string>();
    const events: string[] = [];

    await Promise.all([
      mutex.run("guild-1", async () => {
        events.push("first:start");
        await delay(20);
        events.push("first:end");
      }),
      mutex.run("guild-1", () => {
        events.push("second");
        return Promise.resolve();
      }),
    ]);

    expect(events).toEqual(["first:start", "first:end", "second"]);
  });

  it("lets different keys run concurrently", async () => {
    const mutex = new KeyedMutex<string>();
    const events: string[] = [];

    await Promise.all([
      mutex.run("guild-1", async () => {
        await delay(20);
        events.push("guild-1");
      }),
      mutex.run("guild-2", () => {
        events.push("guild-2");
        return Promise.resolve();
      }),
    ]);

    expect(events).toEqual(["guild-2", "guild-1"]);
  });

  it("keeps the queue alive after a failing task and forgets idle keys", async () => {
    const mutex = new KeyedMutex<string>();

    await expect(mutex.run("guild-1", () => Promise.reject(new Error("boom")))).rejects.toThrow(
      "boom",
    );
    await expect(mutex.run("guild-1", () => Promise.resolve("next"))).resolves.toBe("next");

    await delay(0);
    expect(mutex.activeKeys).toBe(0);
  });
});
