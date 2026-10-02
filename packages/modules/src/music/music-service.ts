import { KeyedMutex } from "@lunaecho/core";

import type { MusicBackend, MusicBackendEvent } from "./music-backend.js";
import { MusicQueue } from "./music-queue.js";
import {
  defaultVolume,
  idleDisconnectMilliseconds,
  maximumVolume,
  technicalMaximumQueueLength,
  type LoopMode,
  type MusicTrack,
} from "./music-track.js";

export type MusicRequester = Readonly<{
  /** Whether the member may control playback when the server restricts it to a DJ role. */
  isDj: boolean;
  /** Where the command was used; LunaEcho reports playback problems there. */
  textChannelId?: string | null;
  userId: string;
  voiceChannelId: string | null;
}>;

/** Something listeners must hear about that happened after their command was answered. */
export type MusicNotice =
  | Readonly<{
      guildId: string;
      kind: "track-failed";
      reason: string | null;
      textChannelId: string | null;
      track: MusicTrack;
    }>
  | Readonly<{ guildId: string; kind: "stopped-after-failures"; textChannelId: string | null }>;

export type PlayResult =
  | Readonly<{
      dropped: number;
      kind: "playing" | "queued";
      playlistName: string | null;
      position: number;
      tracks: readonly MusicTrack[];
    }>
  | Readonly<{ kind: "different-channel"; voiceChannelId: string }>
  | Readonly<{ kind: "module-off" | "no-results" | "not-in-voice" | "queue-full" }>
  | Readonly<{ kind: "search-failed"; message: string }>
  | Readonly<{ kind: "session-limit" }>;

export type ControlResult = "done" | "no-session" | "not-allowed" | "not-in-channel";

export type SessionSnapshot = Readonly<{
  current: MusicTrack | undefined;
  loopMode: LoopMode;
  paused: boolean;
  upcoming: readonly MusicTrack[];
  voiceChannelId: string;
  volume: number;
}>;

export type MusicTimers = Readonly<{
  clear: (handle: unknown) => void;
  set: (callback: () => void, milliseconds: number) => unknown;
}>;

export type MusicServiceOptions = Readonly<{
  canPlay?: (guildId: string) => Promise<boolean>;
  /** Whether controls require the DJ role in this guild. */
  isDjRestricted?: (guildId: string) => Promise<boolean>;
  /** Most sessions one bot process plays at once; bounded by the audio backend's capacity. */
  maximumSessions?: number;
  onError?: (error: unknown, guildId: string) => void;
  onNotice?: (notice: MusicNotice) => void;
  resolveDefaultVolume?: (guildId: string) => Promise<number>;
  resolveQueueLimit?: (guildId: string) => Promise<number | null>;
  timers?: MusicTimers;
}>;

interface MusicSession {
  consecutiveFailures: number;
  idleTimer: unknown;
  paused: boolean;
  readonly queue: MusicQueue;
  textChannelId: string | null;
  readonly voiceChannelId: string;
  volume: number;
}

/** Tracks that fail one after another usually mean a broken source; stop instead of looping. */
const maximumConsecutiveFailures = 5;

const nodeTimers: MusicTimers = {
  clear: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
  set: (callback, milliseconds) => setTimeout(callback, milliseconds).unref(),
};

/**
 * One music session per guild: a queue, a voice connection, and the rules for moving through
 * the queue. All work for one guild is serialized; audio itself runs in the backend.
 */
export class MusicService {
  private readonly canPlay: (guildId: string) => Promise<boolean>;
  private connecting = 0;
  private readonly isDjRestricted: (guildId: string) => Promise<boolean>;
  private readonly maximumSessions: number;
  private readonly mutex = new KeyedMutex<string>();
  private readonly resolveDefaultVolume: (guildId: string) => Promise<number>;
  private readonly resolveQueueLimit: (guildId: string) => Promise<number | null>;
  private readonly sessions = new Map<string, MusicSession>();
  private readonly timers: MusicTimers;

  public constructor(
    private readonly backend: MusicBackend,
    private readonly options: MusicServiceOptions = {},
  ) {
    this.canPlay = options.canPlay ?? (() => Promise.resolve(true));
    this.isDjRestricted = options.isDjRestricted ?? (() => Promise.resolve(false));
    this.maximumSessions = options.maximumSessions ?? 200;
    this.resolveDefaultVolume =
      options.resolveDefaultVolume ?? (() => Promise.resolve(defaultVolume));
    this.resolveQueueLimit = options.resolveQueueLimit ?? (() => Promise.resolve(null));
    this.timers = options.timers ?? nodeTimers;
    backend.subscribe((event) => {
      void this.handleBackendEvent(event).catch((error: unknown) => {
        this.options.onError?.(error, event.guildId);
      });
    });
  }

  public get activeSessions(): number {
    return this.sessions.size;
  }

  public getSession(guildId: string): SessionSnapshot | undefined {
    const session = this.sessions.get(guildId);

    return session === undefined
      ? undefined
      : {
          current: session.queue.current,
          loopMode: session.queue.loopMode,
          paused: session.paused,
          upcoming: [...session.queue.pending],
          voiceChannelId: session.voiceChannelId,
          volume: session.volume,
        };
  }

  public async play(
    guildId: string,
    requester: MusicRequester,
    query: string,
  ): Promise<PlayResult> {
    if (requester.voiceChannelId === null) {
      return { kind: "not-in-voice" };
    }

    const voiceChannelId = requester.voiceChannelId;

    if (!(await this.canPlay(guildId))) {
      return { kind: "module-off" };
    }

    // Searching happens outside the guild lock: it is the slowest step and changes nothing.
    const result = await this.backend.search(query, requester.userId);

    if (result.kind === "empty") {
      return { kind: "no-results" };
    }

    if (result.kind === "error") {
      return { kind: "search-failed", message: result.message };
    }

    const tracks = result.kind === "playlist" ? result.tracks : result.tracks.slice(0, 1);
    const playlistName = result.kind === "playlist" ? result.name : null;

    return this.mutex.run(guildId, async () => {
      let session = this.sessions.get(guildId);

      if (session !== undefined && session.voiceChannelId !== voiceChannelId) {
        return { kind: "different-channel", voiceChannelId: session.voiceChannelId };
      }

      if (session === undefined) {
        // Other guilds run concurrently, so the slot is reserved before the slow connect;
        // counting only finished sessions let the stress test exceed the limit by a third.
        if (this.sessions.size + this.connecting >= this.maximumSessions) {
          return { kind: "session-limit" };
        }

        this.connecting += 1;

        try {
          await this.backend.connect(guildId, voiceChannelId);
          session = {
            consecutiveFailures: 0,
            idleTimer: undefined,
            paused: false,
            queue: new MusicQueue(),
            textChannelId: requester.textChannelId ?? null,
            voiceChannelId,
            volume: await this.resolveDefaultVolume(guildId),
          };
          this.sessions.set(guildId, session);
        } finally {
          this.connecting -= 1;
        }
      }

      // Problems are reported where the latest request came from.
      session.textChannelId = requester.textChannelId ?? session.textChannelId;
      const limit = Math.min(
        (await this.resolveQueueLimit(guildId)) ?? technicalMaximumQueueLength,
        technicalMaximumQueueLength,
      );
      const position = session.queue.size + 1;
      const { added, dropped } = session.queue.add(tracks, limit);

      if (added === 0) {
        return { kind: "queue-full" };
      }

      const startsNow = session.queue.current === undefined;

      if (startsNow) {
        await this.playNext(guildId, session, false);
      }

      return {
        dropped,
        kind: startsNow ? "playing" : "queued",
        playlistName,
        position: startsNow ? 0 : position,
        tracks: tracks.slice(0, added),
      };
    });
  }

  public skip(guildId: string, requester: MusicRequester): Promise<ControlResult> {
    return this.control(guildId, requester, (session) => this.playNext(guildId, session, true));
  }

  public stop(guildId: string, requester: MusicRequester): Promise<ControlResult> {
    return this.control(guildId, requester, () => this.endSession(guildId));
  }

  public setPaused(
    guildId: string,
    requester: MusicRequester,
    paused: boolean,
  ): Promise<ControlResult> {
    return this.control(guildId, requester, async (session) => {
      await this.backend.setPaused(guildId, paused);
      session.paused = paused;
    });
  }

  public setVolume(
    guildId: string,
    requester: MusicRequester,
    volume: number,
  ): Promise<ControlResult> {
    const clamped = Math.round(Math.min(Math.max(volume, 0), maximumVolume));

    return this.control(guildId, requester, async (session) => {
      await this.backend.setVolume(guildId, clamped);
      session.volume = clamped;
    });
  }

  public setLoopMode(
    guildId: string,
    requester: MusicRequester,
    mode: LoopMode,
  ): Promise<ControlResult> {
    return this.control(guildId, requester, (session) => {
      session.queue.setLoopMode(mode);
      return Promise.resolve();
    });
  }

  public shuffle(guildId: string, requester: MusicRequester): Promise<ControlResult> {
    return this.control(guildId, requester, (session) => {
      session.queue.shuffle();
      return Promise.resolve();
    });
  }

  /** Removes the track at a 1-based queue position; "not-allowed" also covers a bad position. */
  public remove(
    guildId: string,
    requester: MusicRequester,
    position: number,
  ): Promise<ControlResult> {
    return this.control(guildId, requester, (session) => {
      if (session.queue.remove(position) === undefined) {
        throw new QueuePositionError();
      }

      return Promise.resolve();
    }).catch((error: unknown) => {
      if (error instanceof QueuePositionError) {
        return "not-allowed" as const;
      }

      throw error;
    });
  }

  /**
   * Called when the humans in the bot's voice channel change. A player left alone disconnects
   * after the idle timeout, unless someone joins again before that.
   */
  public handleListenerCount(guildId: string, voiceChannelId: string, listeners: number): void {
    const session = this.sessions.get(guildId);

    if (session?.voiceChannelId !== voiceChannelId) {
      return;
    }

    if (listeners === 0) {
      this.startIdleTimer(guildId, session);
    } else if (session.queue.current !== undefined) {
      this.cancelIdleTimer(session);
    }
  }

  /** Stops every session, for example when the process shuts down. */
  public async shutdown(): Promise<void> {
    await Promise.all(
      [...this.sessions.keys()].map((guildId) =>
        this.mutex.run(guildId, () => this.endSession(guildId)),
      ),
    );
  }

  private cancelIdleTimer(session: MusicSession): void {
    if (session.idleTimer !== undefined) {
      this.timers.clear(session.idleTimer);
      session.idleTimer = undefined;
    }
  }

  private async control(
    guildId: string,
    requester: MusicRequester,
    action: (session: MusicSession) => Promise<void>,
  ): Promise<ControlResult> {
    const restricted = await this.isDjRestricted(guildId);

    return this.mutex.run(guildId, async () => {
      const session = this.sessions.get(guildId);

      if (session === undefined) {
        return "no-session";
      }

      if (requester.voiceChannelId !== session.voiceChannelId) {
        return "not-in-channel";
      }

      if (restricted && !requester.isDj) {
        return "not-allowed";
      }

      await action(session);
      return "done";
    });
  }

  private async endSession(guildId: string): Promise<void> {
    const session = this.sessions.get(guildId);

    if (session === undefined) {
      return;
    }

    this.cancelIdleTimer(session);
    session.queue.clear();
    this.sessions.delete(guildId);
    await this.backend.disconnect(guildId);
  }

  private handleBackendEvent(event: MusicBackendEvent): Promise<void> {
    return this.mutex.run(event.guildId, async () => {
      const session = this.sessions.get(event.guildId);

      if (session === undefined) {
        return;
      }

      if (event.kind === "disconnected") {
        this.cancelIdleTimer(session);
        this.sessions.delete(event.guildId);
        return;
      }

      // Stopped, replaced, and cleanup come from LunaEcho's own actions and need no reaction.
      if (event.reason !== "finished" && event.reason !== "failed") {
        return;
      }

      session.consecutiveFailures = event.reason === "failed" ? session.consecutiveFailures + 1 : 0;
      const failedTrack = event.reason === "failed" ? session.queue.current : undefined;

      if (failedTrack !== undefined) {
        this.options.onNotice?.({
          guildId: event.guildId,
          kind: "track-failed",
          reason: event.failure ?? null,
          textChannelId: session.textChannelId,
          track: failedTrack,
        });
      }

      if (session.consecutiveFailures >= maximumConsecutiveFailures) {
        await this.endSession(event.guildId);
        this.options.onNotice?.({
          guildId: event.guildId,
          kind: "stopped-after-failures",
          textChannelId: session.textChannelId,
        });
        return;
      }

      await this.playNext(event.guildId, session, event.reason === "failed");
    });
  }

  private async playNext(guildId: string, session: MusicSession, skipped: boolean): Promise<void> {
    const next = session.queue.advance(skipped);

    if (next === undefined) {
      await this.backend.stop(guildId);
      session.paused = false;
      this.startIdleTimer(guildId, session);
      return;
    }

    this.cancelIdleTimer(session);
    session.paused = false;
    await this.backend.play(guildId, next, session.volume);
  }

  private startIdleTimer(guildId: string, session: MusicSession): void {
    if (session.idleTimer !== undefined) {
      return;
    }

    session.idleTimer = this.timers.set(() => {
      void this.mutex
        .run(guildId, async () => {
          if (this.sessions.get(guildId) === session) {
            await this.endSession(guildId);
          }
        })
        .catch((error: unknown) => {
          this.options.onError?.(error, guildId);
        });
    }, idleDisconnectMilliseconds);
  }
}

class QueuePositionError extends Error {}
