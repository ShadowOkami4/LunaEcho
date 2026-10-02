import { describe, expect, it } from "vitest";

import { ExpiringCache } from "../src/index.js";

function createCache(maximumEntries: number) {
  let now = 0;
  const cache = new ExpiringCache<string, number>({
    clock: () => new Date(now),
    maximumEntries,
    ttlMilliseconds: 1_000,
  });

  return {
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
    cache,
  };
}

describe("ExpiringCache", () => {
  it("returns a value until its lifetime ends and then forgets it", () => {
    const { advance, cache } = createCache(10);
    cache.set("guild-1", 1);

    advance(999);
    expect(cache.get("guild-1")).toBe(1);

    advance(1);
    expect(cache.get("guild-1")).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it("never holds more than the maximum number of entries", () => {
    const { cache } = createCache(2);
    cache.set("guild-1", 1);
    cache.set("guild-2", 2);
    cache.set("guild-3", 3);

    expect(cache.size).toBe(2);
    expect(cache.get("guild-1")).toBeUndefined();
    expect(cache.get("guild-2")).toBe(2);
    expect(cache.get("guild-3")).toBe(3);
  });

  it("treats a rewritten key as the newest entry", () => {
    const { cache } = createCache(2);
    cache.set("guild-1", 1);
    cache.set("guild-2", 2);
    cache.set("guild-1", 10);
    cache.set("guild-3", 3);

    expect(cache.get("guild-1")).toBe(10);
    expect(cache.get("guild-2")).toBeUndefined();
  });

  it("drops an entry on request", () => {
    const { cache } = createCache(2);
    cache.set("guild-1", 1);
    cache.delete("guild-1");

    expect(cache.get("guild-1")).toBeUndefined();
  });
});
