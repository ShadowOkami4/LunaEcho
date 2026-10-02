/**
 * Runs tasks one after another per key while different keys run concurrently. Voice and music
 * events for one guild must not interleave, but separate guilds should never wait for each other.
 */
export class KeyedMutex<Key> {
  private readonly tails = new Map<Key, Promise<void>>();

  /** The number of keys that currently have running or queued work. */
  public get activeKeys(): number {
    return this.tails.size;
  }

  public run<Result>(key: Key, task: () => Promise<Result>): Promise<Result> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const result = previous.then(task);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );

    this.tails.set(key, tail);
    void tail.then(() => {
      // Only the last queued task may remove the key, so the map never keeps idle guilds.
      if (this.tails.get(key) === tail) {
        this.tails.delete(key);
      }
    });

    return result;
  }
}
