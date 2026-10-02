import type { VoiceRoomService } from "@lunaecho/modules";
import {
  InteractionContextType,
  SlashCommandBuilder,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord.js";

import type { ChatInputCommand } from "../../infrastructure/discord/commands/chat-input-command.js";
import { respondWithPanelEphemerally } from "../../infrastructure/discord/commands/interaction-responder.js";
import { createRoomPanel, resolveRoomActor } from "./room-panel.js";

/** One command; everything else happens in the panel it opens. */
export const roomCommandData: RESTPostAPIChatInputApplicationCommandsJSONBody =
  new SlashCommandBuilder()
    .setName("room")
    .setDescription("Change the settings of the voice room you are in.")
    .setContexts(InteractionContextType.Guild)
    .toJSON();

export function createRoomCommand(service: VoiceRoomService): ChatInputCommand {
  return {
    data: roomCommandData,
    guildOnly: true,
    requiredCapability: "voice-rooms",

    async execute({ interaction }): Promise<void> {
      if (!interaction.inCachedGuild()) {
        throw new Error("Room command executed outside a cached guild");
      }

      const info = await service.getRoomInfo(interaction.guildId, resolveRoomActor(interaction));
      await respondWithPanelEphemerally(interaction, createRoomPanel(info, interaction.user.id));
    },
  };
}
