import type { AppLogger } from "@lunaecho/core";
import { GatewayIntentBits } from "discord.js";

/** Application flags that tell whether a privileged intent is switched on in the portal. */
const intentFlags = {
  guildMembers: [1 << 14, 1 << 15],
  messageContent: [1 << 18, 1 << 19],
} as const;

export type GatewayIntents = Readonly<{
  intents: readonly GatewayIntentBits[];
  /** Join and leave events, welcome messages, autoroles. */
  members: boolean;
  /** Message text for AutoMod, banned words, and message logs. */
  messageContent: boolean;
}>;

function hasFlag(flags: number, [full, limited]: readonly [number, number]): boolean {
  return (flags & full) !== 0 || (flags & limited) !== 0;
}

/**
 * Requests only the privileged intents the Discord application has switched on. Asking for one
 * that is off makes Discord refuse the connection, which would stop self-hosters' bots from
 * starting at all; the affected features report themselves as limited instead.
 */
export async function resolveGatewayIntents(
  token: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<GatewayIntents> {
  const response = await fetchImplementation("https://discord.com/api/v10/applications/@me", {
    headers: {
      authorization: `Bot ${token}`,
      "user-agent": "DiscordBot (https://shadowokami.com/LunaEcho, 0.1.0)",
    },
  });

  if (!response.ok) {
    throw new Error(`Reading the Discord application failed with HTTP ${response.status}`);
  }

  const flags = ((await response.json()) as { flags?: number }).flags ?? 0;
  const members = hasFlag(flags, intentFlags.guildMembers);
  const messageContent = hasFlag(flags, intentFlags.messageContent);

  return {
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildModeration,
      ...(members ? [GatewayIntentBits.GuildMembers] : []),
      ...(messageContent ? [GatewayIntentBits.MessageContent] : []),
    ],
    members,
    messageContent,
  };
}

export function logGatewayIntents(intents: GatewayIntents, logger: AppLogger): void {
  if (!intents.messageContent) {
    logger.warn(
      "Message Content Intent is off in the Developer Portal: AutoMod, banned words, and message logs cannot read messages",
    );
  }

  if (!intents.members) {
    logger.warn(
      "Server Members Intent is off in the Developer Portal: welcome messages, autoroles, and join/leave logs are disabled",
    );
  }
}
