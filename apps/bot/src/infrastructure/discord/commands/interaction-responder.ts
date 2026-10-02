import {
  MessageFlags,
  type InteractionEditReplyOptions,
  type InteractionReplyOptions,
  type MessageComponentInteraction,
  type ModalSubmitInteraction,
  type RepliableInteraction,
} from "discord.js";

import { createPanel, type PanelOptions } from "../components/panel.js";

type ComponentsV2ResponseOptions = Omit<
  InteractionReplyOptions,
  "content" | "embeds" | "flags" | "poll"
> &
  Required<Pick<InteractionReplyOptions, "components">>;

export async function respondWithComponentsV2Ephemerally(
  interaction: RepliableInteraction,
  options: ComponentsV2ResponseOptions,
): Promise<void> {
  const response = {
    ...options,
    allowedMentions: options.allowedMentions ?? { parse: [] },
    flags: [MessageFlags.Ephemeral, MessageFlags.IsComponentsV2],
  } satisfies InteractionReplyOptions;

  if (interaction.deferred && !interaction.replied) {
    await interaction.editReply({
      ...options,
      allowedMentions: response.allowedMentions,
      flags: MessageFlags.IsComponentsV2,
    } satisfies InteractionEditReplyOptions);
    return;
  }

  if (interaction.replied) {
    await interaction.followUp(response);
    return;
  }

  await interaction.reply(response);
}

export function respondWithPanelEphemerally(
  interaction: RepliableInteraction,
  options: PanelOptions,
): Promise<void> {
  return respondWithComponentsV2Ephemerally(interaction, {
    components: [createPanel(options)],
  });
}

/**
 * Replaces the panel a button, select menu, or modal belongs to, so a control panel updates in
 * place instead of piling up new messages. Falls back to a new ephemeral panel otherwise.
 */
export async function updatePanel(
  interaction: MessageComponentInteraction | ModalSubmitInteraction,
  options: PanelOptions,
): Promise<void> {
  if (interaction.isModalSubmit() && !interaction.isFromMessage()) {
    await respondWithPanelEphemerally(interaction, options);
    return;
  }

  await interaction.update({
    allowedMentions: { parse: [] },
    components: [createPanel(options)],
    flags: MessageFlags.IsComponentsV2,
  });
}
