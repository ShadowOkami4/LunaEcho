import type { AppLogger } from "@lunaecho/core";
import type {
  MusicBackend,
  MusicBackendEvent,
  MusicSearchResult,
  MusicTrack,
  TrackEndReason,
} from "@lunaecho/modules";
import type { Client } from "discord.js";
import {
  Connectors,
  LoadType,
  Shoukaku,
  type NodeOption,
  type Player,
  type Track,
  type TrackEndReason as LavalinkTrackEndReason,
} from "shoukaku";

export type LavalinkBackendOptions = Readonly<{
  client: Client;
  logger: AppLogger;
  nodes: readonly NodeOption[];
  /** Search prefixes tried in order for plain-text queries, for example `ytsearch`. */
  searchSources: readonly string[];
}>;

/** Discord closes the voice socket with this code when the bot is disconnected or moved out. */
const disconnectedCloseCode = 4014;

const endReasons = {
  cleanup: "cleanup",
  finished: "finished",
  loadFailed: "failed",
  replaced: "replaced",
  stopped: "stopped",
} as const satisfies Record<LavalinkTrackEndReason, TrackEndReason>;

function toMusicTrack(track: Track, requesterId: string): MusicTrack {
  return {
    author: track.info.author,
    durationMilliseconds: track.info.length,
    encoded: track.encoded,
    isStream: track.info.isStream,
    requesterId,
    source: track.info.sourceName,
    title: track.info.title,
    uri: track.info.uri ?? null,
  };
}

/**
 * Plays audio through Lavalink. Decoding and streaming run in the Lavalink process, so heavy
 * music load never blocks the bot's event loop, and Lavalink can run on another machine.
 */
export class LavalinkMusicBackend implements MusicBackend {
  /** The latest exception per guild; Lavalink reports it just before the failed track ends. */
  private readonly lastFailures = new Map<string, string>();
  private readonly listeners: ((event: MusicBackendEvent) => void)[] = [];
  private readonly shoukaku: Shoukaku;

  public constructor(private readonly options: LavalinkBackendOptions) {
    this.shoukaku = new Shoukaku(new Connectors.DiscordJS(options.client), [...options.nodes], {
      moveOnDisconnect: true,
      reconnectInterval: 10,
      reconnectTries: 30,
      resume: false,
      voiceConnectionTimeout: 15,
    });

    this.shoukaku.on("ready", (name) => {
      options.logger.info({ node: name }, "Lavalink node connected");
    });
    this.shoukaku.on("error", (name, error) => {
      options.logger.error({ err: error, node: name }, "Lavalink node error");
    });
    this.shoukaku.on("close", (name, code, reason) => {
      options.logger.warn({ code, node: name, reason }, "Lavalink node connection closed");
    });
  }

  public async connect(guildId: string, voiceChannelId: string): Promise<void> {
    const player = await this.shoukaku.joinVoiceChannel({
      channelId: voiceChannelId,
      deaf: true,
      guildId,
      shardId: this.options.client.guilds.cache.get(guildId)?.shardId ?? 0,
    });
    this.observe(player);
  }

  public async disconnect(guildId: string): Promise<void> {
    await this.shoukaku.leaveVoiceChannel(guildId);
  }

  public async play(guildId: string, track: MusicTrack, volume: number): Promise<void> {
    await this.requirePlayer(guildId).playTrack({ track: { encoded: track.encoded }, volume });
  }

  public async search(query: string, requesterId: string): Promise<MusicSearchResult> {
    const node = this.shoukaku.getIdealNode();

    if (node === undefined) {
      return { kind: "error", message: "No Lavalink node is connected." };
    }

    const identifiers = /^https?:\/\//iu.test(query)
      ? [query]
      : this.options.searchSources.map((source) => `${source}:${query}`);

    for (const identifier of identifiers) {
      const response = await node.rest.resolve(identifier);

      switch (response?.loadType) {
        case LoadType.TRACK:
          return { kind: "tracks", tracks: [toMusicTrack(response.data, requesterId)] };
        case LoadType.SEARCH:
          if (response.data.length > 0) {
            return {
              kind: "tracks",
              tracks: response.data.map((track) => toMusicTrack(track, requesterId)),
            };
          }
          break;
        case LoadType.PLAYLIST:
          return {
            kind: "playlist",
            name: response.data.info.name,
            tracks: response.data.tracks.map((track) => toMusicTrack(track, requesterId)),
          };
        case LoadType.ERROR:
          this.options.logger.warn(
            { identifier, severity: response.data.severity },
            "Lavalink could not load a track",
          );
          return { kind: "error", message: response.data.message };
        default:
          // Empty: the next search source may still find something.
          break;
      }
    }

    return { kind: "empty" };
  }

  public async setPaused(guildId: string, paused: boolean): Promise<void> {
    await this.requirePlayer(guildId).setPaused(paused);
  }

  public async setVolume(guildId: string, volume: number): Promise<void> {
    await this.requirePlayer(guildId).setGlobalVolume(volume);
  }

  public async stop(guildId: string): Promise<void> {
    await this.requirePlayer(guildId).stopTrack();
  }

  public subscribe(listener: (event: MusicBackendEvent) => void): void {
    this.listeners.push(listener);
  }

  private emit(event: MusicBackendEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private observe(player: Player): void {
    const guildId = player.guildId;

    player.on("end", (event) => {
      const reason = endReasons[event.reason];
      const failure = this.lastFailures.get(guildId);
      this.lastFailures.delete(guildId);
      this.emit({
        guildId,
        kind: "track-end",
        reason,
        ...(reason === "failed" && failure !== undefined ? { failure } : {}),
      });
    });
    player.on("stuck", () => {
      this.emit({
        failure: "The stream stopped delivering audio.",
        guildId,
        kind: "track-end",
        reason: "failed",
      });
    });
    player.on("exception", (event) => {
      // Lavalink sends whole stack traces; the first line says what went wrong.
      const message = event.exception.message.split("\n")[0]?.trim() ?? "Unknown error";
      this.lastFailures.set(guildId, message);
      this.options.logger.warn(
        { guildId, message, severity: event.exception.severity },
        "Lavalink could not play a track",
      );
    });
    player.on("closed", (event) => {
      if (event.code === disconnectedCloseCode) {
        void this.shoukaku.leaveVoiceChannel(guildId).finally(() => {
          this.emit({ guildId, kind: "disconnected" });
        });
      }
    });
  }

  private requirePlayer(guildId: string): Player {
    const player = this.shoukaku.players.get(guildId);

    if (player === undefined) {
      throw new Error(`No Lavalink player exists for guild ${guildId}`);
    }

    return player;
  }
}
