import type { AppLogger } from "@lunaecho/core";
import {
  maximumRoomNameLength,
  maximumRoomUserLimit,
  VoiceRoomInputError,
  type RoomActionResult,
  type VoiceRoomService,
} from "@lunaecho/modules";
import { LabelBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from "discord.js";

import type {
  ComponentInteractionHandler,
  RoutedComponentInteraction,
} from "../../infrastructure/discord/commands/component-interaction-registry.js";
import { updatePanel } from "../../infrastructure/discord/commands/interaction-responder.js";
import {
  createRoomPanel,
  resolveRoomActor,
  roomPanelIds,
  roomPanelPrefix,
  roomResultMessages,
  runRoomPanelAction,
} from "./room-panel.js";

const fieldId = "value";

function form(
  customId: string,
  title: string,
  label: string,
  input: TextInputBuilder,
): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title)
    .addLabelComponents(new LabelBuilder().setLabel(label).setTextInputComponent(input));
}

/** Buttons, member pickers, and forms of the `/room` panel. */
export class RoomPanelHandler implements ComponentInteractionHandler {
  public readonly customIdPrefix = roomPanelPrefix;
  public readonly requiredCapability = "voice-rooms";

  public constructor(private readonly service: VoiceRoomService) {}

  public async handle(interaction: RoutedComponentInteraction, logger: AppLogger): Promise<void> {
    if (!interaction.inCachedGuild()) {
      return;
    }

    const guildId = interaction.guildId;
    const actor = resolveRoomActor(interaction);

    // Rename and limit ask for a value first; the form's submission comes back to this handler.
    if (interaction.isButton() && interaction.customId === roomPanelIds.rename) {
      await interaction.showModal(
        form(
          roomPanelIds.renameForm,
          "Rename your room",
          "New name",
          new TextInputBuilder()
            .setCustomId(fieldId)
            .setStyle(TextInputStyle.Short)
            .setMaxLength(maximumRoomNameLength)
            .setRequired(true),
        ),
      );
      return;
    }

    if (interaction.isButton() && interaction.customId === roomPanelIds.limit) {
      await interaction.showModal(
        form(
          roomPanelIds.limitForm,
          "Member limit",
          `0 for no limit, at most ${maximumRoomUserLimit}`,
          new TextInputBuilder()
            .setCustomId(fieldId)
            .setStyle(TextInputStyle.Short)
            .setMaxLength(2)
            .setRequired(true),
        ),
      );
      return;
    }

    let result: RoomActionResult;

    try {
      if (interaction.isModalSubmit()) {
        const value = interaction.fields.getTextInputValue(fieldId);
        result =
          interaction.customId === roomPanelIds.renameForm
            ? await this.service.renameRoom(guildId, actor, value)
            : await this.service.setUserLimit(guildId, actor, Number(value.trim()));
      } else {
        result = await runRoomPanelAction(
          this.service,
          guildId,
          actor,
          interaction.customId,
          interaction.isUserSelectMenu() ? interaction.values[0] : undefined,
        );
      }
    } catch (error) {
      if (!(error instanceof VoiceRoomInputError)) {
        throw error;
      }

      const info = await this.service.getRoomInfo(guildId, actor);
      await updatePanel(interaction, createRoomPanel(info, actor.userId, error.message));
      return;
    }

    if (result !== "done") {
      logger.debug({ customId: interaction.customId, result }, "Room panel action refused");
    }

    const info = await this.service.getRoomInfo(guildId, actor);
    await updatePanel(interaction, createRoomPanel(info, actor.userId, roomResultMessages[result]));
  }
}
