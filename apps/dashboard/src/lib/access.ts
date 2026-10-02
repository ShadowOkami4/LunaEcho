import "server-only";

import { notFound, redirect } from "next/navigation";
import { cache } from "react";

import { fetchBotGuildIds, fetchUserGuilds, type DiscordPartialGuild } from "./discord";
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

export async function listManageableGuilds(session: ActiveSession): Promise<ManageableGuild[]> {
  const [userGuilds, botGuilds] = await Promise.all([
    fetchUserGuilds(session.accessToken),
    fetchBotGuildIds(),
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

/**
 * Checked on every page and every change: the signed-in user must be allowed to manage the
 * server and LunaEcho must be in it. Anything else looks like a missing page.
 */
async function loadManageableGuild(
  guildId: string,
): Promise<Readonly<{ guild: ManageableGuild; session: ActiveSession }>> {
  const session = await requireSession();
  const guild = (await listManageableGuilds(session)).find((candidate) => candidate.id === guildId);

  if (guild?.botPresent !== true) {
    notFound();
  }

  return { guild, session };
}

/** Shared by the layout and the page of one request, so the check runs once per view. */
export const requireManageableGuild = cache(loadManageableGuild);
