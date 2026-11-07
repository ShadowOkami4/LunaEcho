import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { CustomBot } from "@lunaecho/modules";
import { notFound } from "next/navigation";
import { cache } from "react";
import { z } from "zod";

import { listManageableGuilds, requireSession, type ManageableGuild } from "./access";
import {
  fetchGuildChannels,
  fetchGuildRoles,
  type BotIdentity,
  type DiscordChannel,
  type DiscordRole,
} from "./discord";
import { env } from "./env";
import { scopeBase, type Scope } from "./scope";
import { customBotServices, services, type DashboardServices } from "./services";
import type { ActiveSession } from "./session";

export type { Scope };
export { scopeBase };

export type Workspace = Readonly<{
  app: DashboardServices;
  /** The settings pages of this scope, for example /bots/<bot>/servers/<server>. */
  base: string;
  /** The Custom bot, when the scope has one. */
  customBot: CustomBot | undefined;
  /** Channels and roles as this scope's bot sees them. */
  discord: Readonly<{
    channels(): Promise<readonly DiscordChannel[]>;
    roles(): Promise<readonly DiscordRole[]>;
  }>;
  guild: ManageableGuild;
  /** Where "switch server" leads: all servers, or this Custom bot's servers. */
  serverList: string;
  session: ActiveSession;
}>;

const snowflake = z.string().regex(/^\d{17,20}$/);
const botIdPattern = z.uuid();

/** The scope a settings form was sent from; HiddenGuild writes both fields. */
export function scopeFromForm(formData: FormData): Scope {
  const botId = formData.get("botId");
  return {
    botId: typeof botId === "string" && botId !== "" ? botIdPattern.parse(botId) : undefined,
    guildId: snowflake.parse(formData.get("guildId")),
  };
}

/** True when this dashboard can reach Custom bot databases at all. */
export function customServersAvailable(): boolean {
  const config = env();
  return (
    config.CUSTOM_BOT_TOKEN_KEY_FILE !== undefined &&
    config.CUSTOM_DATABASE_HOST !== undefined &&
    config.CUSTOM_SECRETS_DIR !== undefined
  );
}

export type CustomBotAccess = Readonly<{
  app: DashboardServices;
  bot: CustomBot;
  identity: BotIdentity;
}>;

/**
 * Opens one of the signed-in user's Custom bots: its own database, logged in with the password
 * the orchestrator created for it, and its token for Discord. Bots of other users, unknown ids,
 * and bots whose database does not exist yet all look like a missing page.
 */
async function loadCustomBot(userId: string, botId: string): Promise<CustomBotAccess> {
  const config = env();
  const control = await services();

  if (
    control.customBots === undefined ||
    config.CUSTOM_DATABASE_HOST === undefined ||
    config.CUSTOM_SECRETS_DIR === undefined ||
    !botIdPattern.safeParse(botId).success
  ) {
    notFound();
  }

  const opened = await control.customBots.openOwned(userId, botId).catch(() => undefined);

  if (opened === undefined) {
    notFound();
  }

  // The orchestrator writes this file the first time it starts the bot.
  const password = await readFile(
    join(config.CUSTOM_SECRETS_DIR, botId, "database-password"),
    "utf8",
  ).catch(() => undefined);

  if (password === undefined) {
    notFound();
  }

  const name = opened.databaseName;
  const url = `postgres://${name}:${encodeURIComponent(password.trim())}@${config.CUSTOM_DATABASE_HOST}/${name}`;

  return {
    app: await customBotServices(botId, url),
    bot: opened.bot,
    identity: { key: botId, token: opened.token },
  };
}

/** Shared by everything one request renders. */
export const requireCustomBot = cache(async (botId: string) => {
  const session = await requireSession();
  return { ...(await loadCustomBot(session.user.id, botId)), session };
});

/**
 * Checked on every settings page and every change: the signed-in user must be allowed to manage
 * the server, the bot must be in it, and a Custom bot must be theirs. Anything else is not found.
 */
async function loadWorkspace(guildId: string, botId: string | undefined): Promise<Workspace> {
  const scope: Scope = { botId, guildId };

  if (botId === undefined) {
    const session = await requireSession();
    const guild = (await listManageableGuilds(session)).find(
      (candidate) => candidate.id === guildId,
    );

    if (guild?.botPresent !== true) {
      notFound();
    }

    return {
      app: await services(),
      base: scopeBase(scope),
      customBot: undefined,
      discord: {
        channels: () => fetchGuildChannels(guildId),
        roles: () => fetchGuildRoles(guildId),
      },
      guild,
      serverList: "/servers",
      session,
    };
  }

  const { app, bot, identity, session } = await requireCustomBot(botId);
  const guild = (await listManageableGuilds(session, identity)).find(
    (candidate) => candidate.id === guildId,
  );

  if (guild?.botPresent !== true) {
    notFound();
  }

  return {
    app,
    base: scopeBase(scope),
    customBot: bot,
    discord: {
      channels: () => fetchGuildChannels(guildId, identity),
      roles: () => fetchGuildRoles(guildId, identity),
    },
    guild,
    serverList: `/bots/${botId}`,
    session,
  };
}

/** Takes primitives so React's per-request cache shares one check between layout and page. */
export const requireWorkspace = cache(loadWorkspace);

/** For pages: params carry the server and, under /bots/<bot>/servers, the bot. */
export async function workspaceFor(
  params: Promise<Readonly<{ botId?: string; guildId: string }>>,
): Promise<Workspace & Readonly<{ guildId: string; scope: Scope }>> {
  const { botId, guildId } = await params;
  const scope: Scope = { botId, guildId };
  return { ...(await requireWorkspace(guildId, botId)), guildId, scope };
}
