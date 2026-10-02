import type { Clock } from "../time/clock.js";

export type ExpiringCacheOptions = Readonly<{
  clock: Clock;
  /** Upper bound on retained entries, so memory stays flat however many keys are seen. */
  maximumEntries: number;
  ttlMilliseconds: number;
}>;

/**
 * A small in-process cache whose entries expire after a fixed lifetime. When it is full, the
 * entry written longest ago, which is also the next one to expire, makes room for the new one.
 */
export class ExpiringCache<Key, Value> {
  private readonly entries = new Map<Key, Readonly<{ expiresAt: number; value: Value }>>();

  public constructor(private readonly options: ExpiringCacheOptions) {}

  public get size(): number {
    return this.entries.size;
  }

  public delete(key: Key): void {
    this.entries.delete(key);
  }

  public get(key: Key): Value | undefined {
    const entry = this.entries.get(key);

    if (entry === undefined) {
      return undefined;
    }

    if (entry.expiresAt <= this.options.clock().getTime()) {
      this.entries.delete(key);
      return undefined;
    }

    return entry.value;
  }

  public set(key: Key, value: Value): void {
    // Re-inserting moves the key to the end, keeping the map ordered by write time.
    this.entries.delete(key);
    this.entries.set(key, {
      expiresAt: this.options.clock().getTime() + this.options.ttlMilliseconds,
      value,
    });

    if (this.entries.size > this.options.maximumEntries) {
      const oldest = this.entries.keys().next();

      if (oldest.done !== true) {
        this.entries.delete(oldest.value);
      }
    }
  }
}
