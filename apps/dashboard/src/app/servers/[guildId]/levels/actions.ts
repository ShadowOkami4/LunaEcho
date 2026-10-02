"use server";

import { LevelSettingsInputError } from "@lunaecho/modules";
import { z } from "zod";

import { channelTypes } from "@/lib/discord";

import { SettingsForm } from "../form";

const page = "/levels";

export async function saveLevelSettings(formData: FormData): Promise<void> {
  const form = await SettingsForm.open(formData, page);
  const announceMode = z.enum(["channel", "current", "off"]).parse(formData.get("announceMode"));

  await form.attempt(async () => {
    await form.app.levels.saveSettings(
      {
        announceChannelId: await form.channel("announceChannelId", [channelTypes.text]),
        announceMode,
        announceTemplate: form.text("announceTemplate"),
        guildId: form.guildId,
        ignoredChannelIds: await form.channels("ignoredChannelIds", [
          channelTypes.text,
          channelTypes.voice,
        ]),
        ignoredRoleIds: await form.roles("ignoredRoleIds"),
        messageCooldownSeconds: form.number("messageCooldownSeconds"),
        messageXpMax: form.number("messageXpMax"),
        messageXpMin: form.number("messageXpMin"),
        stackRewards: form.checked("stackRewards"),
        voiceXpPerMinute: form.number("voiceXpPerMinute"),
      },
      form.actorId,
    );
  }, [LevelSettingsInputError]);
  await form.saved("levels");
}

export async function saveLevelReward(formData: FormData): Promise<void> {
  const form = await SettingsForm.open(formData, page);
  let result: "limit-reached" | "saved" = "saved";

  await form.attempt(async () => {
    result = await form.app.levels.setReward(
      form.guildId,
      form.number("level"),
      await form.requiredRole("roleId"),
    );
  }, [LevelSettingsInputError]);
  await form.saved("levels", result);
}

export async function removeLevelReward(formData: FormData): Promise<void> {
  const form = await SettingsForm.open(formData, page);
  await form.app.levels.removeReward(form.guildId, form.number("level"));
  await form.saved("levels", "removed");
}
