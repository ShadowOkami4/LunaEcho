import { MusicSettingsService, VoiceRoomService } from "@lunaecho/modules";
import {
  InMemoryMusicSettingsRepository,
  InMemoryVoiceRoomRepository,
  SimulatedVoicePlatform,
} from "@lunaecho/modules/testing";
import { describe, expect, it } from "vitest";

import {
  CommandRegistry,
  DuplicateCommandError,
} from "../../src/infrastructure/discord/commands/command-registry.js";
import { ComponentInteractionRegistry } from "../../src/infrastructure/discord/commands/component-interaction-registry.js";
import { createCommandDefinitions } from "../../src/modules/command-definitions.js";
import { MusicPanelHandler } from "../../src/modules/music/music-panel-handler.js";
import { infoCommand } from "../../src/modules/system/info-command.js";
import { RoomPanelHandler } from "../../src/modules/voice-rooms/room-panel-handler.js";

describe("commands", () => {
  it("keeps only everyday commands; settings live in the dashboard", () => {
    expect(createCommandDefinitions().map((definition) => definition.name)).toEqual([
      "info",
      "moderate",
      "music",
      "rank",
      "remind",
      "room",
    ]);
  });

  it("routes every panel control to its handler", () => {
    const components = new ComponentInteractionRegistry([
      new MusicPanelHandler(
        undefined,
        new MusicSettingsService(new InMemoryMusicSettingsRepository()),
      ),
      new RoomPanelHandler(
        new VoiceRoomService(new InMemoryVoiceRoomRepository(), new SimulatedVoicePlatform()),
      ),
    ]);

    expect(components.find("music:skip")?.customIdPrefix).toBe("music:");
    expect(components.find("room:rename-form")?.customIdPrefix).toBe("room:");
    expect(components.find("unknown:x")).toBeUndefined();
  });

  it("rejects duplicate command names at startup", () => {
    expect(() => new CommandRegistry([infoCommand, infoCommand])).toThrow(DuplicateCommandError);
  });
});
