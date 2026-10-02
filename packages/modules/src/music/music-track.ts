export type MusicTrack = Readonly<{
  author: string;
  durationMilliseconds: number;
  /** Opaque track data from the audio backend, passed back unchanged to play the track. */
  encoded: string;
  isStream: boolean;
  requesterId: string;
  source: string;
  title: string;
  uri: string | null;
}>;

export type MusicSearchResult =
  | Readonly<{ kind: "empty" }>
  | Readonly<{ kind: "error"; message: string }>
  | Readonly<{ kind: "playlist"; name: string; tracks: readonly MusicTrack[] }>
  | Readonly<{ kind: "tracks"; tracks: readonly MusicTrack[] }>;

export type LoopMode = "off" | "queue" | "track";

export const loopModes = ["off", "track", "queue"] as const satisfies readonly LoopMode[];

/** Volume in percent; Lavalink accepts up to 1000, but anything above 150 distorts badly. */
export const maximumVolume = 150;
export const defaultVolume = 80;

/** Queue length when no plan quota applies; one entry costs about 1 KB of memory. */
export const technicalMaximumQueueLength = 1_000;

/** How long a player may stay idle or alone in a channel before it disconnects. */
export const idleDisconnectMilliseconds = 120_000;

export function formatTrackDuration(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const paddedSeconds = seconds.toString().padStart(2, "0");

  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, "0")}:${paddedSeconds}`
    : `${minutes}:${paddedSeconds}`;
}
