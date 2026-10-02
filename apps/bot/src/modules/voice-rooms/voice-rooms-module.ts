import { VoiceRoomService, DrizzleVoiceRoomRepository } from "@lunaecho/modules";
import type { LunaDatabase } from "@lunaecho/db";

import type { BotModule, ModuleContext } from "../../infrastructure/discord/bot-module.js";
import { DiscordVoiceRoomPlatform } from "./discord-voice-room-platform.js";
import { createRoomCommand } from "./room-command.js";
import { RoomPanelHandler } from "./room-panel-handler.js";
import { createVoiceRoomListeners } from "./voice-room-event-handlers.js";

export function createVoiceRoomsModule(
  context: ModuleContext,
  database: LunaDatabase,
  loadTestBotIds: ReadonlySet<string>,
): Readonly<{ module: BotModule; voiceRooms: VoiceRoomService }> {
  const logger = context.logger.child({ component: "voice-rooms" });
  const voiceRooms = new VoiceRoomService(
    new DrizzleVoiceRoomRepository(database),
    new DiscordVoiceRoomPlatform(context.client),
    { canCreateRooms: (guildId) => context.moduleRuns(guildId, "voice-rooms") },
  );

  if (loadTestBotIds.size > 0) {
    logger.warn(
      { bots: loadTestBotIds.size },
      "LOAD_TEST_BOT_IDS is set: these bots get voice rooms like members",
    );
  }

  return {
    module: {
      commands: [createRoomCommand(voiceRooms)],
      components: [new RoomPanelHandler(voiceRooms)],
      invalidate: (guildId) => {
        voiceRooms.invalidate(guildId);
      },
      listeners: createVoiceRoomListeners(voiceRooms, logger, loadTestBotIds),
      name: "voice-rooms",
      onReady: async (client) => {
        // Removes rooms that emptied or were deleted while the bot was offline.
        const removed = await voiceRooms.reconcile(
          (guildId) => client.guilds.cache.get(guildId)?.available === true,
        );
        logger.info({ removed }, "Voice rooms reconciled after startup");
      },
    },
    voiceRooms,
  };
}
