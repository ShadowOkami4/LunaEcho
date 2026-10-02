import { MusicService, type MusicRequester, type PlayResult } from "@lunaecho/modules";
import { SimulatedMusicBackend } from "@lunaecho/modules/testing";

import { sleep, type LatencyRecorder, type StateProbes } from "./metrics.js";

export type MusicLoadOptions = Readonly<{
  actionsPerGuildPerSecond: number;
  backendLatencyMilliseconds: number;
  durationSeconds: number;
  guilds: number;
  maximumSessions: number;
  random: () => number;
  probes: StateProbes;
  recorder: LatencyRecorder;
  /** Simulated song length; short songs stress the track-change path. */
  trackLengthMilliseconds: number;
}>;

export type MusicLoadReport = Readonly<{
  actions: number;
  audioNodeCalls: number;
  invariantViolations: readonly string[];
  peakSessions: number;
  playResults: Readonly<Record<string, number>>;
  searches: number;
}>;

const tickMilliseconds = 50;

/**
 * Listeners in many guilds request songs and playlists, skip, pause, change volume, and stop,
 * while simulated songs finish on their own. The real MusicService does the work.
 */
export async function runMusicLoad(options: MusicLoadOptions): Promise<MusicLoadReport> {
  const { random, recorder } = options;
  const backend = new SimulatedMusicBackend({
    latencyMilliseconds: options.backendLatencyMilliseconds,
    playlistLength: 50,
    trackLengthMilliseconds: options.trackLengthMilliseconds,
  });
  const service = new MusicService(backend, { maximumSessions: options.maximumSessions });
  const inFlight = new Set<Promise<unknown>>();
  const playResults: Record<string, number> = {};
  let actions = 0;
  let peakSessions = 0;

  const track = (promise: Promise<unknown>): void => {
    const guarded = promise.catch(() => undefined);
    inFlight.add(guarded);
    void guarded.finally(() => inFlight.delete(guarded));
  };
  const listener = (guildId: string): MusicRequester => ({
    isDj: true,
    userId: `listener-${Math.floor(random() * 20)}`,
    voiceChannelId: `${guildId}:voice`,
  });
  const recordPlay = (result: PlayResult): void => {
    playResults[result.kind] = (playResults[result.kind] ?? 0) + 1;
    peakSessions = Math.max(peakSessions, service.activeSessions);
  };

  const guildIds = Array.from({ length: options.guilds }, (_, index) => `guild-${index}`);
  options.probes.set("musicSessions", () => service.activeSessions);
  options.probes.set("queuedSongs", () =>
    guildIds.reduce(
      (total, guildId) => total + (service.getSession(guildId)?.upcoming.length ?? 0),
      0,
    ),
  );
  const act = (guildId: string): void => {
    const roll = random();
    const requester = listener(guildId);
    actions += 1;

    if (roll < 0.35) {
      const query = random() < 0.1 ? `playlist:mix-${guildId}` : `song ${Math.floor(roll * 1e6)}`;
      track(
        recorder
          .measure("music.play", () => service.play(guildId, requester, query))
          .then(recordPlay),
      );
    } else if (roll < 0.5) {
      track(recorder.measure("music.skip", () => service.skip(guildId, requester)));
    } else if (roll < 0.6) {
      track(
        recorder.measure("music.pause", () =>
          service.setPaused(guildId, requester, random() < 0.5),
        ),
      );
    } else if (roll < 0.7) {
      track(
        recorder.measure("music.volume", () =>
          service.setVolume(guildId, requester, Math.floor(random() * 150)),
        ),
      );
    } else if (roll < 0.75) {
      track(recorder.measure("music.shuffle", () => service.shuffle(guildId, requester)));
    } else if (roll < 0.78) {
      track(recorder.measure("music.stop", () => service.stop(guildId, requester)));
    } else {
      track(recorder.measure("music.queue", () => Promise.resolve(service.getSession(guildId))));
    }
  };

  const deadline = Date.now() + options.durationSeconds * 1_000;
  const actionsPerTick = (options.actionsPerGuildPerSecond * tickMilliseconds) / 1_000;
  let carry = 0;

  while (Date.now() < deadline) {
    carry += actionsPerTick;
    const whole = Math.floor(carry);
    carry -= whole;

    for (const guildId of guildIds) {
      for (let action = 0; action < whole; action += 1) {
        act(guildId);
      }
    }

    await sleep(tickMilliseconds);
  }

  while (inFlight.size > 0) {
    await Promise.all([...inFlight]);
  }

  await service.shutdown();
  const violations: string[] = [];

  if (service.activeSessions !== 0) {
    violations.push(`${service.activeSessions} music sessions survived shutdown`);
  }

  if (peakSessions > options.maximumSessions) {
    violations.push(
      `${peakSessions} concurrent sessions exceeded the limit of ${options.maximumSessions}`,
    );
  }

  if (backend.connectedPlayers !== 0) {
    violations.push(`${backend.connectedPlayers} audio players stayed connected after shutdown`);
  }

  return {
    actions,
    audioNodeCalls: backend.calls,
    invariantViolations: violations,
    peakSessions,
    playResults,
    searches: backend.searches,
  };
}
