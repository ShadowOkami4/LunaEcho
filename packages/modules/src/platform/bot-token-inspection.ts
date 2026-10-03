/** What Discord says about a bot token, read before LunaEcho stores it. */
export type BotTokenInspection = Readonly<{
  applicationId: string;
  avatarHash: string | null;
  botUserId: string;
  /** Server Members intent, needed for welcome messages, autoroles, and member logs. */
  hasMembersIntent: boolean;
  /** Message Content intent, needed for AutoMod, keyword automations, and message logs. */
  hasMessageContentIntent: boolean;
  name: string;
}>;

export class BotTokenError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "BotTokenError";
  }
}

const userAgent = "DiscordBot (https://shadowokami.com/LunaEcho, 0.1.0)";
// Application flags: the intent is enabled, or enabled for bots in fewer than 100 servers.
const membersIntentFlags = (1 << 14) | (1 << 15);
const messageContentIntentFlags = (1 << 18) | (1 << 19);
const tokenPattern = /^[\w-]{20,}\.[\w-]{4,}\.[\w-]{20,}$/;

interface ApplicationResponse {
  bot?: { avatar: string | null; id: string; username: string };
  flags?: number;
  id: string;
}

/**
 * Asks Discord which application a bot token belongs to. A wrong or revoked token is refused
 * before anything is stored.
 */
export async function inspectBotToken(
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<BotTokenInspection> {
  const trimmed = token.trim();

  if (!tokenPattern.test(trimmed)) {
    throw new BotTokenError("That does not look like a bot token. Copy it from the Bot page.");
  }

  let response: Response;

  try {
    response = await fetcher("https://discord.com/api/v10/applications/@me", {
      headers: { Authorization: `Bot ${trimmed}`, "User-Agent": userAgent },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new BotTokenError("Discord could not be reached. Please try again.");
  }

  if (response.status === 401) {
    throw new BotTokenError("Discord does not accept this token. Reset it and copy it again.");
  }

  if (!response.ok) {
    throw new BotTokenError(`Discord answered ${response.status}. Please try again later.`);
  }

  const application = (await response.json()) as ApplicationResponse;

  if (application.bot === undefined) {
    throw new BotTokenError("This application has no bot user. Add one on the Bot page.");
  }

  const flags = application.flags ?? 0;
  return {
    applicationId: application.id,
    avatarHash: application.bot.avatar,
    botUserId: application.bot.id,
    hasMembersIntent: (flags & membersIntentFlags) !== 0,
    hasMessageContentIntent: (flags & messageContentIntentFlags) !== 0,
    name: application.bot.username,
  };
}
