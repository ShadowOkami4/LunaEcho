import type { MusicBackend, MusicBackendEvent, TrackEndReason } from "./music-backend.js";
import type { MusicSearchResult, MusicTrack } from "./music-track.js";

export type SimulatedMusicBackendOptions = Readonly<{
  /** Simulated round trip to the audio node for every call, in milliseconds. */
  latencyMilliseconds?: number;
  /** Tracks per result; queries starting with "playlist:" return this many, others one. */
  playlistLength?: number;
  /** Finishes each track automatically after this many milliseconds, like real playback. */
  trackLengthMilliseconds?: number;
}>;

interface SimulatedPlayer {
  endTimer: ReturnType<typeof setTimeout> | undefined;
  paused: boolean;
  track: MusicTrack | undefined;
  voiceChannelId: string;
  volume: number;
}

/** An audio node simulation: resolves fake tracks and reports playback like Lavalink does. */
export class SimulatedMusicBackend implements MusicBackend {
  public calls = 0;
  public searches = 0;
  private readonly listeners: ((event: MusicBackendEvent) => void)[] = [];
  private readonly players = new Map<string, SimulatedPlayer>();
  private nextTrackNumber = 1;

  public constructor(private readonly options: SimulatedMusicBackendOptions = {}) {}

  public get connectedPlayers(): number {
    return this.players.size;
  }

  public playerOf(guildId: string): Readonly<SimulatedPlayer> | undefined {
    return this.players.get(guildId);
  }

  public async connect(guildId: string, voiceChannelId: string): Promise<void> {
    await this.roundTrip();
    this.players.set(guildId, {
      endTimer: undefined,
      paused: false,
      track: undefined,
      voiceChannelId,
      volume: 100,
    });
  }

  public async disconnect(guildId: string): Promise<void> {
    await this.roundTrip();
    const player = this.players.get(guildId);

    if (player?.endTimer !== undefined) {
      clearTimeout(player.endTimer);
    }

    this.players.delete(guildId);
  }

  /** Ends the current track as the audio node would, for example after it finished playing. */
  public finishTrack(guildId: string, reason: TrackEndReason = "finished", failure?: string): void {
    const player = this.players.get(guildId);

    if (player?.track === undefined) {
      return;
    }

    if (player.endTimer !== undefined) {
      clearTimeout(player.endTimer);
      player.endTimer = undefined;
    }

    player.track = undefined;
    this.emit({
      guildId,
      kind: "track-end",
      reason,
      ...(failure === undefined ? {} : { failure }),
    });
  }

  /** The voice connection dropped, for example because an admin disconnected the bot. */
  public dropConnection(guildId: string): void {
    this.players.delete(guildId);
    this.emit({ guildId, kind: "disconnected" });
  }

  public async play(guildId: string, track: MusicTrack, volume: number): Promise<void> {
    await this.roundTrip();
    const player = this.requirePlayer(guildId);

    if (player.track !== undefined) {
      this.finishTrack(guildId, "replaced");
    }

    player.track = track;
    player.volume = volume;
    player.paused = false;
    const length = this.options.trackLengthMilliseconds;

    if (length !== undefined) {
      player.endTimer = setTimeout(() => {
        if (this.players.get(guildId)?.track === track) {
          this.finishTrack(guildId, "finished");
        }
      }, length);
    }
  }

  public async search(query: string, requesterId: string): Promise<MusicSearchResult> {
    await this.roundTrip();
    this.searches += 1;

    if (query.startsWith("empty:")) {
      return { kind: "empty" };
    }

    if (query.startsWith("error:")) {
      return { kind: "error", message: "Simulated source failure" };
    }

    const count = query.startsWith("playlist:") ? (this.options.playlistLength ?? 25) : 1;
    const tracks = Array.from({ length: count }, () => this.createTrack(query, requesterId));

    return query.startsWith("playlist:")
      ? { kind: "playlist", name: query.slice("playlist:".length), tracks }
      : { kind: "tracks", tracks };
  }

  public async setPaused(guildId: string, paused: boolean): Promise<void> {
    await this.roundTrip();
    this.requirePlayer(guildId).paused = paused;
  }

  public async setVolume(guildId: string, volume: number): Promise<void> {
    await this.roundTrip();
    this.requirePlayer(guildId).volume = volume;
  }

  public async stop(guildId: string): Promise<void> {
    await this.roundTrip();
    this.finishTrack(guildId, "stopped");
  }

  public subscribe(listener: (event: MusicBackendEvent) => void): void {
    this.listeners.push(listener);
  }

  private createTrack(query: string, requesterId: string): MusicTrack {
    const number = this.nextTrackNumber;
    this.nextTrackNumber += 1;

    return {
      author: "Simulated Artist",
      durationMilliseconds: 180_000,
      encoded: `encoded-track-${number}`,
      isStream: false,
      requesterId,
      source: "simulation",
      title: `${query} #${number}`,
      uri: null,
    };
  }

  private emit(event: MusicBackendEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private requirePlayer(guildId: string): SimulatedPlayer {
    const player = this.players.get(guildId);

    if (player === undefined) {
      throw new Error(`No simulated player for guild ${guildId}`);
    }

    return player;
  }

  private async roundTrip(): Promise<void> {
    this.calls += 1;
    const latency = this.options.latencyMilliseconds ?? 0;

    if (latency > 0) {
      await new Promise((resolve) => setTimeout(resolve, latency));
    }
  }
}
