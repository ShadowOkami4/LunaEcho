"use server";

import { logCategories } from "@lunaecho/modules";

import { channelTypes } from "@/lib/discord";

import { SettingsForm } from "../form";

export async function saveLogSettings(formData: FormData): Promise<void> {
  const form = await SettingsForm.open(formData, "/logs");
  const channels = Object.fromEntries(
    await Promise.all(
      logCategories.map(
        async (category) =>
          [category, await form.channel(`channel-${category}`, [channelTypes.text])] as const,
      ),
    ),
  ) as Record<(typeof logCategories)[number], string | null>;

  await form.app.logs.save(
    {
      channels,
      guildId: form.guildId,
      ignoredChannelIds: await form.channels("ignoredChannelIds", [
        channelTypes.text,
        channelTypes.voice,
      ]),
    },
    form.actorId,
  );
  await form.saved("logs");
}
