import type { MusicSearchResult, MusicTrack } from "./music-track.js";

/** Why a track stopped, as reported by the audio backend. */
export type TrackEndReason = "cleanup" | "failed" | "finished" | "replaced" | "stopped";

export type MusicBackendEvent =
  | Readonly<{ guildId: string; kind: "disconnected" }>
  | Readonly<{
      /** Why a failed track could not play, as reported by the audio source. */
      failure?: string;
      guildId: string;
      kind: "track-end";
      reason: TrackEndReason;
    }>;

/**
 * The audio side of music playback. The bot implements it with Lavalink, which decodes and
 * streams audio in its own process; the load simulation implements it in memory.
 */
export interface MusicBackend {
  connect(guildId: string, voiceChannelId: string): Promise<void>;
  disconnect(guildId: string): Promise<void>;
  /** Plays a track immediately, replacing whatever is playing. */
  play(guildId: string, track: MusicTrack, volume: number): Promise<void>;
  search(query: string, requesterId: string): Promise<MusicSearchResult>;
  setPaused(guildId: string, paused: boolean): Promise<void>;
  setVolume(guildId: string, volume: number): Promise<void>;
  stop(guildId: string): Promise<void>;
  /** Receives track and connection events; the service registers itself once. */
  subscribe(listener: (event: MusicBackendEvent) => void): void;
}
