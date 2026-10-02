import type { AppLogger } from "@lunaecho/core";
import type { VoiceRoomService } from "@lunaecho/modules";

import { listen, type AnyEventListener } from "../../infrastructure/discord/bot-module.js";

/** Voice state changes open and close rooms; deleted channels are forgotten. */
export function createVoiceRoomListeners(
  service: VoiceRoomService,
  logger: AppLogger,
  loadTestBotIds: ReadonlySet<string>,
): readonly AnyEventListener[] {
  return [
    listen("voiceStateUpdate", "voice-rooms.voice-state", async (oldState, newState) => {
      const member = newState.member ?? oldState.member;
      const events = await service.handleVoiceStateChange({
        displayName: member?.displayName ?? "Voice",
        guildId: newState.guild.id,
        // Helper bots of a live load test are handled like members.
        isBot: (member?.user.bot ?? false) && !loadTestBotIds.has(newState.id),
        newChannelId: newState.channelId,
        oldChannelId: oldState.channelId,
        userId: newState.id,
      });

      for (const event of events) {
        logger.debug({ event: event.kind, guildId: newState.guild.id }, "Voice room event");
      }
    }),
    listen("channelDelete", "voice-rooms.channel-delete", async (channel) => {
      if (!channel.isDMBased()) {
        await service.handleChannelDeleted(channel.guildId, channel.id);
      }
    }),
  ];
}
