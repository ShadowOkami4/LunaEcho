import { ExpiringCache, type Clock } from "@lunaecho/core";
import { logSettings, type LunaDatabase } from "@lunaecho/db";
import { eq } from "drizzle-orm";

export const logCategories = ["moderation", "message", "member", "server", "voice"] as const;

export type LogCategory = (typeof logCategories)[number];

export type LogSettings = Readonly<{
  channels: Readonly<Record<LogCategory, string | null>>;
  guildId: string;
  /** Messages and voice activity in these channels are never logged. */
  ignoredChannelIds: readonly string[];
}>;

export const maximumIgnoredLogChannels = 50;

function defaultsFor(guildId: string): LogSettings {
  return {
    channels: { member: null, message: null, moderation: null, server: null, voice: null },
    guildId,
    ignoredChannelIds: [],
  };
}

export class LogSettingsService {
  private readonly cache: ExpiringCache<string, LogSettings>;

  public constructor(
    private readonly database: LunaDatabase,
    private readonly clock: Clock = () => new Date(),
  ) {
    this.cache = new ExpiringCache({ clock, maximumEntries: 10_000, ttlMilliseconds: 60_000 });
  }

  public invalidate(guildId: string): void {
    this.cache.delete(guildId);
  }

  public async get(guildId: string): Promise<LogSettings> {
    const cached = this.cache.get(guildId);

    if (cached !== undefined) {
      return cached;
    }

    const [row] = await this.database
      .select()
      .from(logSettings)
      .where(eq(logSettings.guildId, guildId));
    const settings: LogSettings =
      row === undefined
        ? defaultsFor(guildId)
        : {
            channels: {
              member: row.memberChannelId,
              message: row.messageChannelId,
              moderation: row.moderationChannelId,
              server: row.serverChannelId,
              voice: row.voiceChannelId,
            },
            guildId,
            ignoredChannelIds: row.ignoredChannelIds,
          };
    this.cache.set(guildId, settings);
    return settings;
  }

  /** The channel to log a category to, or undefined when that category is off. */
  public async channelFor(guildId: string, category: LogCategory): Promise<string | undefined> {
    return (await this.get(guildId)).channels[category] ?? undefined;
  }

  public async save(settings: LogSettings, actorId: string): Promise<void> {
    const ignored = [...new Set(settings.ignoredChannelIds)].slice(0, maximumIgnoredLogChannels);
    const values = {
      ignoredChannelIds: ignored,
      memberChannelId: settings.channels.member,
      messageChannelId: settings.channels.message,
      moderationChannelId: settings.channels.moderation,
      serverChannelId: settings.channels.server,
      updatedAt: this.clock(),
      updatedBy: actorId,
      voiceChannelId: settings.channels.voice,
    };

    await this.database
      .insert(logSettings)
      .values({ ...values, guildId: settings.guildId })
      .onConflictDoUpdate({ set: values, target: logSettings.guildId });
    this.cache.delete(settings.guildId);
  }
}
