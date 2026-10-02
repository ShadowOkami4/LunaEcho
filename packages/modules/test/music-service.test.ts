import { describe, expect, it } from "vitest";

import {
  idleDisconnectMilliseconds,
  MusicQueue,
  MusicService,
  type MusicNotice,
  type MusicRequester,
  type MusicServiceOptions,
  type MusicTimers,
  type MusicTrack,
} from "../src/index.js";
import { SimulatedMusicBackend } from "../src/testing.js";

const guildId = "guild-1";
const listener: MusicRequester = { isDj: false, userId: "alice", voiceChannelId: "voice-1" };

/** Timers that fire only when the test says so. */
function createManualTimers() {
  const pending = new Map<number, Readonly<{ callback: () => void; milliseconds: number }>>();
  let nextHandle = 1;
  const timers: MusicTimers = {
    clear: (handle) => {
      pending.delete(handle as number);
    },
    set: (callback, milliseconds) => {
      const handle = nextHandle;
      nextHandle += 1;
      pending.set(handle, { callback, milliseconds });
      return handle;
    },
  };

  return {
    fireAll: () => {
      const due = [...pending.values()];
      pending.clear();
      due.forEach((timer) => {
        timer.callback();
      });
    },
    pending,
    timers,
  };
}

function createPlayer(options: MusicServiceOptions = {}) {
  const backend = new SimulatedMusicBackend();
  const clock = createManualTimers();
  const service = new MusicService(backend, { timers: clock.timers, ...options });
  return { backend, clock, service };
}

/** Lets queued guild work, such as reactions to backend events, finish. */
async function settle(): Promise<void> {
  for (let round = 0; round < 10; round += 1) {
    await Promise.resolve();
  }
}

function track(title: string): MusicTrack {
  return {
    author: "Artist",
    durationMilliseconds: 1_000,
    encoded: title,
    isStream: false,
    requesterId: "alice",
    source: "test",
    title,
    uri: null,
  };
}

describe("MusicQueue", () => {
  it("advances, repeats a track, and cycles the whole queue", () => {
    const queue = new MusicQueue();
    queue.add([track("a"), track("b"), track("c")], 10);

    expect(queue.advance()?.title).toBe("a");
    queue.setLoopMode("track");
    expect(queue.advance()?.title).toBe("a");
    expect(queue.advance(true)?.title).toBe("b");
    queue.setLoopMode("queue");
    expect(queue.advance()?.title).toBe("c");
    expect(queue.pending.map((entry) => entry.title)).toEqual(["b"]);
    expect(queue.advance()?.title).toBe("b");
    expect(queue.pending.map((entry) => entry.title)).toEqual(["c"]);
  });

  it("respects the maximum length and removes by position", () => {
    const queue = new MusicQueue();

    expect(queue.add([track("a"), track("b"), track("c")], 2)).toEqual({ added: 2, dropped: 1 });
    expect(queue.remove(3)).toBeUndefined();
    expect(queue.remove(1)?.title).toBe("a");
  });
});

describe("MusicService", () => {
  it("connects, plays the first result, and queues further requests", async () => {
    const { backend, service } = createPlayer();

    await expect(service.play(guildId, listener, "first song")).resolves.toMatchObject({
      kind: "playing",
    });
    await expect(service.play(guildId, listener, "second song")).resolves.toMatchObject({
      kind: "queued",
      position: 1,
    });

    expect(backend.playerOf(guildId)?.voiceChannelId).toBe("voice-1");
    expect(backend.playerOf(guildId)?.track?.title).toContain("first song");
    expect(service.getSession(guildId)?.upcoming).toHaveLength(1);
  });

  it("plays the next track when one finishes and idles out when the queue ends", async () => {
    const { backend, clock, service } = createPlayer();
    await service.play(guildId, listener, "one");
    await service.play(guildId, listener, "two");

    backend.finishTrack(guildId);
    await settle();
    expect(backend.playerOf(guildId)?.track?.title).toContain("two");

    backend.finishTrack(guildId);
    await settle();
    expect(backend.playerOf(guildId)?.track).toBeUndefined();
    expect([...clock.pending.values()][0]?.milliseconds).toBe(idleDisconnectMilliseconds);

    clock.fireAll();
    await settle();
    expect(service.activeSessions).toBe(0);
    expect(backend.connectedPlayers).toBe(0);
  });

  it("adds whole playlists up to the queue limit", async () => {
    const { service } = createPlayer({ resolveQueueLimit: () => Promise.resolve(10) });

    const result = await service.play(guildId, listener, "playlist:Road trip");

    expect(result).toMatchObject({ dropped: 15, kind: "playing", playlistName: "Road trip" });
    expect(service.getSession(guildId)?.upcoming).toHaveLength(9);
    await expect(service.play(guildId, listener, "one more")).resolves.toMatchObject({
      kind: "queued",
    });
    await expect(service.play(guildId, listener, "too many")).resolves.toEqual({
      kind: "queue-full",
    });
  });

  it("reports why a request cannot be played", async () => {
    const { service } = createPlayer({ maximumSessions: 1 });

    await expect(
      service.play(guildId, { ...listener, voiceChannelId: null }, "song"),
    ).resolves.toEqual({ kind: "not-in-voice" });
    await expect(service.play(guildId, listener, "empty:nothing")).resolves.toEqual({
      kind: "no-results",
    });
    await expect(service.play(guildId, listener, "error:broken")).resolves.toMatchObject({
      kind: "search-failed",
    });

    await service.play(guildId, listener, "song");
    await expect(
      service.play(guildId, { ...listener, voiceChannelId: "voice-2" }, "song"),
    ).resolves.toEqual({ kind: "different-channel", voiceChannelId: "voice-1" });
    await expect(service.play("guild-2", listener, "song")).resolves.toEqual({
      kind: "session-limit",
    });
  });

  it("never exceeds the session limit when many guilds connect at once", async () => {
    // Found by the stress test: slow connects let concurrent guilds pass the limit check.
    const backend = new SimulatedMusicBackend({ latencyMilliseconds: 5 });
    const service = new MusicService(backend, { maximumSessions: 10 });

    const results = await Promise.all(
      Array.from({ length: 50 }, (_, index) => service.play(`guild-${index}`, listener, "song")),
    );

    expect(service.activeSessions).toBe(10);
    expect(backend.connectedPlayers).toBe(10);
    expect(results.filter((result) => result.kind === "session-limit")).toHaveLength(40);
  });

  it("limits controls to listeners and, when configured, to DJs", async () => {
    const { backend, service } = createPlayer({ isDjRestricted: () => Promise.resolve(true) });
    await service.play(guildId, listener, "song");

    await expect(
      service.setVolume(guildId, { ...listener, voiceChannelId: "voice-2" }, 50),
    ).resolves.toBe("not-in-channel");
    await expect(service.setVolume(guildId, listener, 50)).resolves.toBe("not-allowed");
    await expect(service.setVolume(guildId, { ...listener, isDj: true }, 500)).resolves.toBe(
      "done",
    );
    expect(backend.playerOf(guildId)?.volume).toBe(150);
    await expect(service.skip("guild-2", listener)).resolves.toBe("no-session");
  });

  it("skips, pauses, loops, shuffles, removes, and stops", async () => {
    const { backend, service } = createPlayer();
    await service.play(guildId, listener, "playlist:Mix");

    await service.setPaused(guildId, listener, true);
    expect(service.getSession(guildId)?.paused).toBe(true);

    await service.skip(guildId, listener);
    expect(backend.playerOf(guildId)?.track?.title).toContain("#2");
    expect(service.getSession(guildId)?.paused).toBe(false);

    await service.setLoopMode(guildId, listener, "track");
    backend.finishTrack(guildId);
    await settle();
    expect(backend.playerOf(guildId)?.track?.title).toContain("#2");

    await service.shuffle(guildId, listener);
    await expect(service.remove(guildId, listener, 1)).resolves.toBe("done");
    await expect(service.remove(guildId, listener, 999)).resolves.toBe("not-allowed");

    await service.stop(guildId, listener);
    expect(service.activeSessions).toBe(0);
    expect(backend.connectedPlayers).toBe(0);
  });

  it("disconnects after being left alone and stays when someone returns", async () => {
    const { clock, service } = createPlayer();
    await service.play(guildId, listener, "song");

    service.handleListenerCount(guildId, "voice-1", 0);
    expect(clock.pending.size).toBe(1);
    service.handleListenerCount(guildId, "voice-1", 1);
    expect(clock.pending.size).toBe(0);

    service.handleListenerCount(guildId, "voice-1", 0);
    clock.fireAll();
    await settle();
    expect(service.activeSessions).toBe(0);
  });

  it("reports unplayable songs and the stop to the channel the request came from", async () => {
    const notices: MusicNotice[] = [];
    const { backend } = createPlayer();
    const service = new MusicService(backend, {
      onNotice: (notice) => notices.push(notice),
      timers: createManualTimers().timers,
    });
    await service.play(guildId, { ...listener, textChannelId: "text-1" }, "playlist:Blocked");

    for (let failure = 0; failure < 5; failure += 1) {
      backend.finishTrack(guildId, "failed", "All clients failed to load the item.");
      await settle();
    }

    expect(notices).toHaveLength(6);
    expect(notices[0]).toMatchObject({
      kind: "track-failed",
      reason: "All clients failed to load the item.",
      textChannelId: "text-1",
      track: { title: expect.stringContaining("Blocked") as unknown },
    });
    expect(notices.at(-1)).toEqual({
      guildId,
      kind: "stopped-after-failures",
      textChannelId: "text-1",
    });
  });
  it("gives up after repeated track failures instead of looping forever", async () => {
    const { backend, service } = createPlayer();
    await service.play(guildId, listener, "playlist:Broken");

    for (let failure = 0; failure < 5; failure += 1) {
      backend.finishTrack(guildId, "failed");
      await settle();
    }

    expect(service.activeSessions).toBe(0);
  });

  it("forgets a session whose voice connection dropped", async () => {
    const { backend, service } = createPlayer();
    await service.play(guildId, listener, "song");

    backend.dropConnection(guildId);
    await settle();

    expect(service.activeSessions).toBe(0);
    await expect(service.play(guildId, listener, "again")).resolves.toMatchObject({
      kind: "playing",
    });
  });
});
