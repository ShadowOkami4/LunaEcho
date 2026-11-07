import "server-only";

import { redirect } from "next/navigation";

import {
  fetchBotGuildIds,
  fetchUserGuilds,
  type BotIdentity,
  type DiscordPartialGuild,
} from "./discord";
import { canManage } from "./permissions";
import { getActiveSession, type ActiveSession } from "./session";

export type ManageableGuild = DiscordPartialGuild & Readonly<{ botPresent: boolean }>;

export async function requireSession(): Promise<ActiveSession> {
  const session = await getActiveSession();

  if (session === undefined) {
    redirect("/");
  }

  return session;
}

/** The user's servers they may manage, marked where the bot (LunaEcho or a Custom bot) is in. */
export async function listManageableGuilds(
  session: ActiveSession,
  identity?: BotIdentity,
): Promise<ManageableGuild[]> {
  const [userGuilds, botGuilds] = await Promise.all([
    fetchUserGuilds(session.accessToken),
    fetchBotGuildIds(identity),
  ]);

  return userGuilds
    .filter(canManage)
    .map((guild) => ({ ...guild, botPresent: botGuilds.has(guild.id) }))
    .sort((left, right) =>
      left.botPresent === right.botPresent
        ? left.name.localeCompare(right.name)
        : left.botPresent
          ? -1
          : 1,
    );
}
