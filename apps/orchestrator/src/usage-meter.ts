import { toError, type AppLogger } from "@lunaecho/core";
import { utcDay, type CustomBotService } from "@lunaecho/modules";

const userAgent = "DiscordBot (https://shadowokami.com/LunaEcho, 0.1.0)";
/** Discord returns at most 200 servers per page. */
const pageSize = 200;

interface PartialGuild {
  approximate_member_count?: number;
  id: string;
}

/** Every server a bot is in, with Discord's approximate member counts added up. */
export async function countGuilds(
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<Readonly<{ guildCount: number; memberCount: number }>> {
  let after = "0";
  let guildCount = 0;
  let memberCount = 0;

  for (;;) {
    const url = `https://discord.com/api/v10/users/@me/guilds?with_counts=true&limit=${pageSize}&after=${after}`;
    const response = await fetcher(url, {
      headers: { Authorization: `Bot ${token}`, "User-Agent": userAgent },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      throw new Error(`Discord answered ${response.status} for the server list`);
    }

    const page = (await response.json()) as PartialGuild[];
    guildCount += page.length;
    memberCount += page.reduce((sum, guild) => sum + (guild.approximate_member_count ?? 0), 0);

    const last = page.at(-1);

    if (page.length < pageSize || last === undefined) {
      return { guildCount, memberCount };
    }

    after = last.id;
  }
}

/**
 * Takes one size reading a day for every running Custom bot. Billing averages them over 30 days,
 * so a missed day costs the customer nothing: it simply counts as zero.
 */
export class UsageMeter {
  public constructor(
    private readonly bots: CustomBotService,
    private readonly logger: AppLogger,
    private readonly fetcher: typeof fetch = fetch,
    private readonly clock: () => Date = () => new Date(),
    private readonly pauseMilliseconds = 1_000,
  ) {}

  public async measureOnce(): Promise<number> {
    const day = utcDay(this.clock());
    const done = await this.bots.measuredOn(day);
    const due = (await this.bots.listDeployments()).filter(
      (bot) => bot.desiredState === "running" && bot.status === "running" && !done.has(bot.id),
    );
    let measured = 0;

    for (const bot of due) {
      try {
        const counts = await countGuilds(this.bots.openToken(bot), this.fetcher);
        await this.bots.recordUsage({
          botId: bot.id,
          day,
          ownerUserId: bot.ownerUserId,
          ...counts,
        });
        measured += 1;
      } catch (error) {
        this.logger.warn({ botId: bot.id, err: toError(error) }, "Size reading failed");
      }

      // One bot at a time, gently, so Discord's rate limits never matter.
      await new Promise((resolve) => setTimeout(resolve, this.pauseMilliseconds));
    }

    return measured;
  }
}
