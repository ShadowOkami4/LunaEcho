import { ExpiringCache } from "@lunaecho/core";

/**
 * Caches the pending request rather than its result, so parallel callers (a layout and its page
 * render at the same time) share one Discord request instead of racing into the rate limit.
 * Failed requests are forgotten at once, so the next call tries again.
 */
export function shared<Value>(
  cache: ExpiringCache<string, Promise<Value>>,
  key: string,
  load: () => Promise<Value>,
): Promise<Value> {
  const cached = cache.get(key);

  if (cached !== undefined) {
    return cached;
  }

  const pending = load();
  cache.set(key, pending);
  pending.catch(() => {
    if (cache.get(key) === pending) {
      cache.delete(key);
    }
  });
  return pending;
}

export function promiseCache<Value>(ttlMilliseconds: number, maximumEntries: number) {
  return new ExpiringCache<string, Promise<Value>>({
    clock: () => new Date(),
    maximumEntries,
    ttlMilliseconds,
  });
}
