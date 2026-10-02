import "server-only";

import { env } from "./env";
import { promiseCache, shared } from "./shared-request";
import { permissions } from "./permissions";

export { permissions };

const apiBase = "https://discord.com/api/v10";

/** Discord rejects API requests without a bot user agent (error 40333). */
const userAgent = "DiscordBot (https://shadowokami.com/LunaEcho, 0.1.0)";

export type DiscordUser = Readonly<{
  avatar: string | null;
  global_name: string | null;
  id: string;
  username: string;
}>;

export type DiscordPartialGuild = Readonly<{
  icon: string | null;
  id: string;
  name: string;
  owner: boolean;
  permissions: string;
}>;

export type DiscordChannel = Readonly<{
  id: string;
  name: string;
  parent_id?: string | null;
  position: number;
  type: number;
}>;

export type DiscordRole = Readonly<{
  /** The role colour as an RGB integer; 0 means the role has no colour. */
  color: number;
  id: string;
  managed: boolean;
  name: string;
  position: number;
}>;

export const channelTypes = { category: 4, text: 0, voice: 2 } as const;

export class DiscordApiError extends Error {
  public constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "DiscordApiError";
  }
}

async function request<Result>(
  path: string,
  authorization: string,
  init: RequestInit = {},
): Promise<Result> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const headers = new Headers(init.headers);
    headers.set("authorization", authorization);
    headers.set("user-agent", userAgent);
    const response = await fetch(`${apiBase}${path}`, { ...init, cache: "no-store", headers });

    if (response.status === 429) {
      // Discord says how long to wait; one short retry keeps pages working under bursts.
      const retryAfter = Number(response.headers.get("retry-after") ?? "1");
      await new Promise((resolve) => setTimeout(resolve, Math.min(retryAfter, 5) * 1_000));
      continue;
    }

    if (!response.ok) {
      throw new DiscordApiError(
        response.status,
        `Discord API ${path} failed with ${response.status}`,
      );
    }

    return (await response.json()) as Result;
  }

  throw new DiscordApiError(429, `Discord API ${path} stayed rate limited`);
}

const bot = (): string => `Bot ${env().DISCORD_TOKEN}`;

export function authorizeUrl(state: string): string {
  const environment = env();
  const parameters = new URLSearchParams({
    client_id: environment.DISCORD_APPLICATION_ID,
    prompt: "none",
    redirect_uri: `${environment.DASHBOARD_URL}/api/auth/callback`,
    response_type: "code",
    scope: "identify guilds",
    state,
  });
  return `https://discord.com/oauth2/authorize?${parameters.toString()}`;
}

export async function exchangeCode(
  code: string,
): Promise<Readonly<{ accessToken: string; expiresAt: number }>> {
  const environment = env();
  const response = await fetch(`${apiBase}/oauth2/token`, {
    body: new URLSearchParams({
      client_id: environment.DISCORD_APPLICATION_ID,
      client_secret: environment.DISCORD_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: `${environment.DASHBOARD_URL}/api/auth/callback`,
    }),
    cache: "no-store",
    headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": userAgent },
    method: "POST",
  });

  if (!response.ok) {
    throw new DiscordApiError(response.status, "Discord rejected the login code");
  }

  const token = (await response.json()) as { access_token: string; expires_in: number };
  return { accessToken: token.access_token, expiresAt: Date.now() + token.expires_in * 1_000 };
}

export function fetchCurrentUser(accessToken: string): Promise<DiscordUser> {
  return request("/users/@me", `Bearer ${accessToken}`);
}

const userGuildCache = promiseCache<readonly DiscordPartialGuild[]>(60_000, 5_000);

/** The user's servers with their effective permissions; cached briefly per access token. */
export function fetchUserGuilds(accessToken: string): Promise<readonly DiscordPartialGuild[]> {
  return shared(userGuildCache, accessToken, () =>
    request<DiscordPartialGuild[]>("/users/@me/guilds", `Bearer ${accessToken}`),
  );
}

const botGuildCache = promiseCache<ReadonlySet<string>>(60_000, 1);

/** Every server the bot is in, paged 200 at a time and cached for a minute. */
export function fetchBotGuildIds(): Promise<ReadonlySet<string>> {
  return shared(botGuildCache, "bot", async () => {
    const ids = new Set<string>();
    let after = "0";

    for (;;) {
      const page = await request<DiscordPartialGuild[]>(
        `/users/@me/guilds?limit=200&after=${after}`,
        bot(),
      );
      page.forEach((guild) => ids.add(guild.id));
      const last = page.at(-1);

      if (page.length < 200 || last === undefined) {
        return ids;
      }

      after = last.id;
    }
  });
}

const guildChannelCache = promiseCache<readonly DiscordChannel[]>(30_000, 1_000);

export function fetchGuildChannels(guildId: string): Promise<readonly DiscordChannel[]> {
  return shared(guildChannelCache, guildId, async () =>
    (await request<DiscordChannel[]>(`/guilds/${guildId}/channels`, bot())).sort(
      (left, right) => left.position - right.position,
    ),
  );
}

const guildRoleCache = promiseCache<readonly DiscordRole[]>(30_000, 1_000);

export function fetchGuildRoles(guildId: string): Promise<readonly DiscordRole[]> {
  return shared(guildRoleCache, guildId, async () =>
    (await request<DiscordRole[]>(`/guilds/${guildId}/roles`, bot()))
      .filter((role) => role.id !== guildId && !role.managed)
      .sort((left, right) => right.position - left.position),
  );
}

const botPermissions = [
  permissions.viewChannel,
  permissions.sendMessages,
  permissions.embedLinks,
  permissions.addReactions,
  permissions.readMessageHistory,
  permissions.manageMessages,
  permissions.manageChannels,
  permissions.moderateMembers,
  permissions.kickMembers,
  permissions.banMembers,
  permissions.connect,
  permissions.speak,
  permissions.moveMembers,
  // Autoroles, role menus, level rewards, and verification.
  permissions.manageRoles,
  // Tickets are private threads with a transcript file.
  permissions.createPrivateThreads,
  permissions.sendMessagesInThreads,
  permissions.manageThreads,
  permissions.attachFiles,
].reduce((all, permission) => all | permission, 0n);

export function inviteUrl(guildId: string): string {
  const parameters = new URLSearchParams({
    client_id: env().DISCORD_APPLICATION_ID,
    disable_guild_select: "true",
    guild_id: guildId,
    permissions: botPermissions.toString(),
    scope: "bot applications.commands",
  });
  return `https://discord.com/oauth2/authorize?${parameters.toString()}`;
}

export function guildIconUrl(guild: Readonly<{ icon: string | null; id: string }>): string | null {
  return guild.icon === null
    ? null
    : `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=96`;
}

export function userAvatarUrl(
  user: Readonly<{ avatar: string | null; id: string }>,
  size: 64 | 256 = 64,
): string | null {
  return user.avatar === null
    ? null
    : `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=${size}`;
}
