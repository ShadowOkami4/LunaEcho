import { toError, type AppLogger } from "@lunaecho/core";
import type { LogCategory, LogSettingsService } from "@lunaecho/modules";
import { MessageFlags, type Client } from "discord.js";

import { createPanel, type PanelTone } from "../../infrastructure/discord/components/panel.js";

export type LogEntry = Readonly<{
  body: string;
  /** Ids and other details shown small under the entry. */
  footer?: string;
  title: string;
  tone: PanelTone;
}>;

/** Posts log entries to the channel configured for their category. */
export class LogSender {
  public constructor(
    private readonly client: Client,
    private readonly settings: LogSettingsService,
    private readonly moduleRuns: (guildId: string) => Promise<boolean>,
    private readonly logger: AppLogger,
  ) {}

  /** Whether a category is logged in this guild, checked before any expensive formatting. */
  public async isEnabled(guildId: string, category: LogCategory): Promise<boolean> {
    return (
      (await this.settings.channelFor(guildId, category)) !== undefined &&
      (await this.moduleRuns(guildId))
    );
  }

  public async isIgnored(guildId: string, channelId: string | null): Promise<boolean> {
    return (
      channelId !== null && (await this.settings.get(guildId)).ignoredChannelIds.includes(channelId)
    );
  }

  public async send(guildId: string, category: LogCategory, entry: LogEntry): Promise<void> {
    if (!(await this.moduleRuns(guildId))) {
      return;
    }

    const channelId = await this.settings.channelFor(guildId, category);

    if (channelId === undefined) {
      return;
    }

    const channel = this.client.channels.cache.get(channelId);

    if (!channel?.isSendable()) {
      this.logger.debug({ category, channelId, guildId }, "Log channel is unavailable");
      return;
    }

    try {
      await channel.send({
        // Logs mention people for context but must never ping them.
        allowedMentions: { parse: [] },
        components: [
          createPanel({
            body: entry.body,
            footer: `${entry.footer === undefined ? "" : `${entry.footer} · `}<t:${Math.floor(Date.now() / 1_000)}:f>`,
            title: entry.title,
            tone: entry.tone,
          }),
        ],
        flags: MessageFlags.IsComponentsV2,
      });
    } catch (error) {
      this.logger.warn({ category, err: toError(error), guildId }, "Could not post a log entry");
    }
  }
}

/** Shows message text as a quote, shortened so one entry stays readable. */
export function quote(text: string, maximum = 900): string {
  const shortened = text.length > maximum ? `${text.slice(0, maximum)}…` : text;
  return shortened.length === 0
    ? "-# (no text)"
    : shortened
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
}
