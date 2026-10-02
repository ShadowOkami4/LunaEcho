"use server";

import {
  prepareWelcomeCardBackground,
  welcomeCardBackgrounds,
  WelcomeCardImageError,
  WelcomeCardInputError,
  welcomeCardLayouts,
  WelcomeSettingsInputError,
} from "@lunaecho/modules";
import { z } from "zod";

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

export async function saveWelcomeCard(formData: FormData): Promise<void> {
  const form = await SettingsForm.open(formData, "/welcome");

  await form.attempt(async () => {
    await form.app.welcomeCards.save(
      {
        accentColor: form.text("accentColor"),
        background: z.enum(welcomeCardBackgrounds).parse(form.text("background")),
        goodbyeEnabled: form.checked("goodbyeEnabled"),
        goodbyeSubtitle: form.text("goodbyeSubtitle"),
        goodbyeTitle: form.text("goodbyeTitle"),
        guildId: form.guildId,
        layout: z.enum(welcomeCardLayouts).parse(form.text("layout")),
        overlayOpacity: form.number("overlayOpacity"),
        textColor: form.text("textColor"),
        welcomeEnabled: form.checked("welcomeEnabled"),
        welcomeSubtitle: form.text("welcomeSubtitle"),
        welcomeTitle: form.text("welcomeTitle"),
      },
      form.actorId,
    );
  }, [WelcomeCardInputError]);
  await form.saved("onboarding");
}

/** Stores a re-encoded copy of the picture; the original upload is never kept. */
export async function uploadWelcomeBackground(formData: FormData): Promise<void> {
  const form = await SettingsForm.open(formData, "/welcome");
  const upload = form.file("background") ?? form.finish("invalid");

  await form.attempt(async () => {
    const prepared = await prepareWelcomeCardBackground(new Uint8Array(await upload.arrayBuffer()));
    await form.app.welcomeCards.setBackgroundImage(form.guildId, prepared, form.actorId);
  }, [WelcomeCardImageError]);
  await form.saved("onboarding");
}

export async function removeWelcomeBackground(formData: FormData): Promise<void> {
  const form = await SettingsForm.open(formData, "/welcome");
  await form.app.welcomeCards.setBackgroundImage(form.guildId, null, form.actorId);
  await form.saved("onboarding", "removed");
}
