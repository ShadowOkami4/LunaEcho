"use server";

import {
  normalizeTwitchLogin,
  resolveYouTubeChannel,
  SocialFeedInputError,
  SocialSourceError,
} from "@lunaecho/modules";
import { z } from "zod";

import { channelTypes } from "@/lib/discord";

import { SettingsForm } from "../form";

const page = "/social";

export async function addSocialFeed(formData: FormData): Promise<void> {
  const form = await SettingsForm.open(formData, page);
  const platform = z.enum(["twitch", "youtube"]).parse(formData.get("platform"));
  const channelId = await form.requiredChannel("channelId", [channelTypes.text]);
  const pingRoleId = await form.role("pingRoleId");

  await form.attempt(async () => {
    const source =
      platform === "youtube"
        ? await resolveYouTubeChannel(form.text("creator"))
        : (() => {
            const login = normalizeTwitchLogin(form.text("creator"));
            return { channelId: login, name: login };
          })();
    await form.app.social.add(
      {
        channelId,
        displayName: source.name,
        guildId: form.guildId,
        message: form.optionalText("message"),
        pingRoleId,
        platform,
        sourceId: source.channelId,
      },
      form.actorId,
    );
  }, [SocialFeedInputError, SocialSourceError]);
  await form.saved("social-notifications");
}

export async function removeSocialFeed(formData: FormData): Promise<void> {
  const form = await SettingsForm.open(formData, page);
  await form.app.social.remove(form.guildId, form.text("feedId"));
  await form.saved("social-notifications", "removed");
}
