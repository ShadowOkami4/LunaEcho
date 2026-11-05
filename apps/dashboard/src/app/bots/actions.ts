"use server";

import { BotTokenError, CustomBotError, inspectBotToken } from "@lunaecho/modules";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireSession } from "@/lib/access";
import { services } from "@/lib/services";

import { errorNoticeCookie } from "../servers/[guildId]/ui";

const botId = z.uuid();

function finish(notice: string): never {
  revalidatePath("/bots");
  redirect(`/bots?notice=${encodeURIComponent(notice)}`);
}

/** Every action re-checks the session; a bot can only be changed by its owner. */
async function authorize() {
  const session = await requireSession();
  const bots = (await services()).customBots;

  if (bots === undefined) {
    finish("invalid");
  }

  return { bots, ownerId: session.user.id };
}

/**
 * Runs a change and turns the expected refusals (a bad token, no free slot, another owner's
 * bot) into a message on the page. The text travels in a short-lived cookie, never the URL.
 */
async function attempt(change: () => Promise<string>): Promise<never> {
  let notice: string;

  try {
    notice = await change();
  } catch (error) {
    if (error instanceof BotTokenError || error instanceof CustomBotError) {
      (await cookies()).set(errorNoticeCookie, error.message.slice(0, 300), {
        httpOnly: true,
        maxAge: 60,
        path: "/bots",
        sameSite: "lax",
      });
      finish("error");
    }

    throw error;
  }

  finish(notice);
}

function token(formData: FormData): string {
  const value = formData.get("token");
  return typeof value === "string" ? value : "";
}

export async function addCustomBot(formData: FormData): Promise<void> {
  const { bots, ownerId } = await authorize();

  await attempt(async () => {
    const inspection = await inspectBotToken(token(formData));
    await bots.create(ownerId, token(formData), inspection);
    return inspection.hasMembersIntent && inspection.hasMessageContentIntent
      ? "bot-added"
      : "bot-intents";
  });
}

export async function replaceCustomBotToken(formData: FormData): Promise<void> {
  const { bots, ownerId } = await authorize();
  const id = botId.parse(formData.get("botId"));

  await attempt(async () => {
    await bots.replaceToken(ownerId, id, token(formData), await inspectBotToken(token(formData)));
    return "bot-token";
  });
}

export async function setCustomBotRunning(formData: FormData): Promise<void> {
  const { bots, ownerId } = await authorize();
  const id = botId.parse(formData.get("botId"));
  const running = formData.get("running") === "true";

  await attempt(async () => {
    await bots.setDesiredState(ownerId, id, running ? "running" : "stopped");
    return running ? "bot-started" : "bot-stopped";
  });
}

export async function removeCustomBot(formData: FormData): Promise<void> {
  const { bots, ownerId } = await authorize();
  const id = botId.parse(formData.get("botId"));

  await attempt(async () => {
    await bots.setDesiredState(ownerId, id, "deleted");
    return "bot-removed";
  });
}
