"use server";

import { WelcomeSettingsInputError } from "@lunaecho/modules";

import { channelTypes } from "@/lib/discord";

import { SettingsForm } from "../form";

export async function saveWelcomeSettings(formData: FormData): Promise<void> {
  const form = await SettingsForm.open(formData, "/welcome");
  const current = await form.app.welcome.get(form.guildId);

  await form.attempt(async () => {
    await form.app.welcome.save(
      {
        autoroleIds: await form.roles("autoroleIds"),
        directMessage: form.optionalText("directMessage"),
        goodbyeChannelId: await form.channel("goodbyeChannelId", [channelTypes.text]),
        goodbyeMessage: form.optionalText("goodbyeMessage"),
        guildId: form.guildId,
        verificationChannelId: await form.channel("verificationChannelId", [channelTypes.text]),
        verificationMessageId: current.verificationMessageId,
        verificationRoleId: await form.role("verificationRoleId"),
        verificationText: form.optionalText("verificationText"),
        welcomeChannelId: await form.channel("welcomeChannelId", [channelTypes.text]),
        welcomeMessage: form.optionalText("welcomeMessage"),
      },
      form.actorId,
    );
  }, [WelcomeSettingsInputError]);
  await form.saved("onboarding");
}

export async function postVerificationPanel(formData: FormData): Promise<void> {
  const form = await SettingsForm.open(formData, "/welcome");
  form.app.welcome.invalidate(form.guildId);
  const settings = await form.app.welcome.get(form.guildId);

  if (settings.verificationChannelId === null || settings.verificationRoleId === null) {
    form.finish("verification-incomplete");
  }

  await form.queue("post-verification-panel", {});
  form.finish("posted");
}
