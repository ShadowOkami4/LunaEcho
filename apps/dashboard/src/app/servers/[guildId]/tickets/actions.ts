"use server";

import { TicketSettingsInputError } from "@lunaecho/modules";

import { channelTypes } from "@/lib/discord";

import { SettingsForm } from "../form";

const page = "/tickets";

export async function saveTicketSettings(formData: FormData): Promise<void> {
  const form = await SettingsForm.open(formData, page);
  const current = await form.app.tickets.getSettings(form.guildId);

  await form.attempt(async () => {
    await form.app.tickets.saveSettings(
      {
        guildId: form.guildId,
        maximumOpenPerMember: form.number("maximumOpenPerMember"),
        panelChannelId: await form.channel("panelChannelId", [channelTypes.text]),
        panelMessageId: current.panelMessageId,
        panelText: form.optionalText("panelText"),
        panelTitle: form.optionalText("panelTitle"),
        staffRoleIds: await form.roles("staffRoleIds"),
        transcriptChannelId: await form.channel("transcriptChannelId", [channelTypes.text]),
      },
      form.actorId,
    );
  }, [TicketSettingsInputError]);
  await form.saved("tickets");
}

export async function postTicketPanel(formData: FormData): Promise<void> {
  const form = await SettingsForm.open(formData, page);
  form.app.tickets.invalidate(form.guildId);

  if ((await form.app.tickets.getSettings(form.guildId)).panelChannelId === null) {
    form.finish("ticket-incomplete");
  }

  await form.queue("post-ticket-panel", {});
  form.finish("posted");
}
