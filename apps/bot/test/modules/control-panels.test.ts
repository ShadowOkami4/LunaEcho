import { MusicService, VoiceRoomService } from "@lunaecho/modules";
import {
  InMemoryVoiceRoomRepository,
  SimulatedMusicBackend,
  SimulatedVoicePlatform,
} from "@lunaecho/modules/testing";
import { describe, expect, it } from "vitest";

import {
  createMusicPlayerPanel,
  runMusicPanelAction,
} from "../../src/modules/music/music-panel.js";
import {
  createRoomPanel,
  roomPanelIds,
  runRoomPanelAction,
} from "../../src/modules/voice-rooms/room-panel.js";

const guildId = "guild-1";

function customIds(panel: ReturnType<typeof createRoomPanel>): string[] {
  return (panel.rows ?? []).flatMap((row) =>
    row.components.map((component) => {
      const data = component.toJSON() as { custom_id?: string };
      return data.custom_id ?? "";
    }),
  );
}

describe("music player panel", () => {
  it("shows an empty player without controls", () => {
    expect(createMusicPlayerPanel(undefined)).toMatchObject({ title: "Music player" });
    expect(createMusicPlayerPanel(undefined).rows).toBeUndefined();
  });

  it("pauses, loops, and changes volume through its buttons", async () => {
    const music = new MusicService(new SimulatedMusicBackend());
    const listener = { isDj: false, userId: "alice", voiceChannelId: "voice-1" };
    await music.play(guildId, listener, "playlist:Mix");

    await expect(runMusicPanelAction(music, guildId, listener, "pause")).resolves.toBe("done");
    await runMusicPanelAction(music, guildId, listener, "loop");
    await runMusicPanelAction(music, guildId, listener, "volume-up");

    const session = music.getSession(guildId);
    expect(session).toMatchObject({ loopMode: "track", paused: true, volume: 90 });

    const panel = createMusicPlayerPanel(session, "Paused.");
    expect(panel.body).toContain("> Paused.");
    expect(customIds(panel)).toEqual([
      "music:pause",
      "music:skip",
      "music:stop",
      "music:loop",
      "music:shuffle",
      "music:volume-down",
      "music:volume-up",
      "music:refresh",
    ]);
  });

  it("refuses controls from outside the voice channel", async () => {
    const music = new MusicService(new SimulatedMusicBackend());
    await music.play(guildId, { isDj: false, userId: "alice", voiceChannelId: "voice-1" }, "song");

    await expect(
      runMusicPanelAction(
        music,
        guildId,
        { isDj: false, userId: "bob", voiceChannelId: null },
        "skip",
      ),
    ).resolves.toBe("not-in-channel");
  });
});

describe("room panel", () => {
  async function createRoom() {
    const platform = new SimulatedVoicePlatform();
    const service = new VoiceRoomService(new InMemoryVoiceRoomRepository(), platform);
    platform.addChannel(guildId, "lobby");
    await service.saveLobby({
      actorId: "admin",
      categoryId: null,
      channelId: "lobby",
      guildId,
      nameTemplate: "{user}'s Room",
      userLimit: 0,
    });
    await service.handleVoiceStateChange(platform.setMemberChannel(guildId, "alice", "lobby"));
    const roomId = platform.channelOf(guildId, "alice") ?? "";
    platform.setMemberChannel(guildId, "bob", roomId);
    return { platform, roomId, service };
  }

  it("gives the owner every control and others only claim", async () => {
    const { roomId, service } = await createRoom();
    const info = await service.getRoomInfo(guildId, { channelId: roomId, userId: "alice" });

    expect(customIds(createRoomPanel(info, "alice"))).toEqual(
      expect.arrayContaining([roomPanelIds.rename, roomPanelIds.lock, roomPanelIds.kick]),
    );
    expect(customIds(createRoomPanel(info, "bob"))).toEqual([
      roomPanelIds.claim,
      roomPanelIds.refresh,
    ]);
    expect(createRoomPanel(undefined, "carol").body).toContain(
      "Join one of LunaEcho's voice rooms",
    );
  });

  it("runs lock and member picker actions for the owner only", async () => {
    const { platform, roomId, service } = await createRoom();
    const owner = { channelId: roomId, userId: "alice" };

    await expect(
      runRoomPanelAction(service, guildId, owner, roomPanelIds.lock, undefined),
    ).resolves.toBe("done");
    expect(platform.getRoomDetails(guildId, roomId)?.locked).toBe(true);

    await expect(
      runRoomPanelAction(service, guildId, owner, roomPanelIds.kick, "bob"),
    ).resolves.toBe("done");
    expect(platform.channelOf(guildId, "bob")).toBeNull();

    await expect(
      runRoomPanelAction(
        service,
        guildId,
        { channelId: roomId, userId: "bob" },
        roomPanelIds.lock,
        undefined,
      ),
    ).resolves.toBe("not-owner");
  });
});
