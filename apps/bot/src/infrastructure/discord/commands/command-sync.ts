import { toError, type AppLogger } from "@lunaecho/core";
import type { Client, RESTPostAPIChatInputApplicationCommandsJSONBody } from "discord.js";

/** One server's own (guild-scoped) commands of the application. */
export interface GuildCommandScope {
  readonly id: string;
  /** How many guild-scoped commands the application has in this server. */
  count(): Promise<number>;
  clear(): Promise<void>;
}

/** The parts of a ready client the sync needs; tests pass a stand-in. */
export interface CommandSyncTarget {
  /** Replaces every global command; returns how many are registered afterwards. */
  setGlobal(
    definitions: readonly RESTPostAPIChatInputApplicationCommandsJSONBody[],
  ): Promise<number>;
  guilds(): readonly GuildCommandScope[];
}

export type CommandSyncResult = Readonly<{ clearedGuilds: number; commandCount: number }>;

/**
 * A managed bot (Cloud or Custom) keeps LunaEcho's commands registered with its application by
 * itself instead of relying on a manual deploy. Global commands are replaced on every start;
 * Discord leaves unchanged ones as they are, so a restart costs nothing. Per-server commands left
 * over from whatever the application ran before would show up next to LunaEcho's and fail, so
 * they are removed. A server the bot cannot read commands in is skipped, never fatal.
 */
export async function syncApplicationCommands(
  target: CommandSyncTarget,
  definitions: readonly RESTPostAPIChatInputApplicationCommandsJSONBody[],
  logger: AppLogger,
): Promise<CommandSyncResult> {
  const commandCount = await target.setGlobal(definitions);
  let clearedGuilds = 0;

  for (const guild of target.guilds()) {
    try {
      if ((await guild.count()) > 0) {
        await guild.clear();
        clearedGuilds += 1;
      }
    } catch (error) {
      logger.debug({ err: toError(error), guildId: guild.id }, "Skipped server commands");
    }
  }

  logger.info({ clearedGuilds, commandCount }, "Application commands synced");
  return { clearedGuilds, commandCount };
}

export function discordCommandSyncTarget(client: Client<true>): CommandSyncTarget {
  return {
    guilds: () =>
      [...client.guilds.cache.values()].map((guild) => ({
        clear: async () => {
          await guild.commands.set([]);
        },
        count: async () => (await guild.commands.fetch()).size,
        id: guild.id,
      })),
    setGlobal: async (definitions) =>
      (await client.application.commands.set([...definitions])).size,
  };
}
