import type { LoopMode, MusicTrack } from "./music-track.js";

export type EnqueueResult = Readonly<{
  added: number;
  /** Tracks that did not fit because the queue reached its maximum length. */
  dropped: number;
}>;

/** The playback order for one guild: the current track plus everything waiting after it. */
export class MusicQueue {
  private currentTrack: MusicTrack | undefined;
  private loop: LoopMode = "off";
  private readonly upcoming: MusicTrack[] = [];

  public constructor(private readonly random: () => number = Math.random) {}

  public get current(): MusicTrack | undefined {
    return this.currentTrack;
  }

  public get loopMode(): LoopMode {
    return this.loop;
  }

  public get pending(): readonly MusicTrack[] {
    return this.upcoming;
  }

  public get size(): number {
    return this.upcoming.length;
  }

  public add(tracks: readonly MusicTrack[], maximumLength: number): EnqueueResult {
    const room = Math.max(0, maximumLength - this.upcoming.length);
    const accepted = tracks.slice(0, room);
    this.upcoming.push(...accepted);
    return { added: accepted.length, dropped: tracks.length - accepted.length };
  }

  public clear(): void {
    this.upcoming.length = 0;
    this.currentTrack = undefined;
  }

  /**
   * Moves to the next track. A finished track repeats with loop "track" and goes to the end of
   * the queue with loop "queue"; `skipped` ignores "track" so skipping never replays the song.
   */
  public advance(skipped = false): MusicTrack | undefined {
    const finished = this.currentTrack;

    if (finished !== undefined && this.loop === "track" && !skipped) {
      return finished;
    }

    if (finished !== undefined && this.loop === "queue") {
      this.upcoming.push(finished);
    }

    this.currentTrack = this.upcoming.shift();
    return this.currentTrack;
  }

  /** Removes the track at a 1-based queue position. */
  public remove(position: number): MusicTrack | undefined {
    if (!Number.isInteger(position) || position < 1 || position > this.upcoming.length) {
      return undefined;
    }

    return this.upcoming.splice(position - 1, 1)[0];
  }

  public setLoopMode(mode: LoopMode): void {
    this.loop = mode;
  }

  public shuffle(): void {
    for (let index = this.upcoming.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(this.random() * (index + 1));
      const current = this.upcoming[index];
      const swap = this.upcoming[swapIndex];

      if (current !== undefined && swap !== undefined) {
        this.upcoming[index] = swap;
        this.upcoming[swapIndex] = current;
      }
    }
  }
}
