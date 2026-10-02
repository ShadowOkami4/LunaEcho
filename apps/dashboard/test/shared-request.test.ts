import { describe, expect, it } from "vitest";

import { promiseCache, shared } from "../src/lib/shared-request";

describe("shared", () => {
  it("lets parallel callers share one request", async () => {
    const cache = promiseCache<string>(60_000, 10);
    let calls = 0;
    const load = async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return "guilds";
    };

    const results = await Promise.all([
      shared(cache, "user", load),
      shared(cache, "user", load),
      shared(cache, "user", load),
    ]);

    expect(results).toEqual(["guilds", "guilds", "guilds"]);
    expect(calls).toBe(1);
  });

  it("forgets a failed request so the next call tries again", async () => {
    const cache = promiseCache<string>(60_000, 10);
    let calls = 0;

    await expect(
      shared(cache, "user", () => {
        calls += 1;
        return Promise.reject(new Error("rate limited"));
      }),
    ).rejects.toThrow("rate limited");
    await expect(
      shared(cache, "user", () => {
        calls += 1;
        return Promise.resolve("guilds");
      }),
    ).resolves.toBe("guilds");
    expect(calls).toBe(2);
  });
});
