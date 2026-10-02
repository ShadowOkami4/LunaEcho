import { ExpiringCache } from "@lunaecho/core";

export type CachedLogMessage = Readonly<{
  attachments: number;
  authorId: string;
  channelId: string;
  content: string;
  createdAt: Date;
  guildId: string;
}>;

/** Long enough to show what was deleted; longer texts are cut. */
const maximumStoredLength = 1_000;

/**
 * Remembers recent messages of servers that log messages, so a deletion can still show what was
 * said. discord.js keeps no messages at all to save memory; this cache holds at most 50,000
 * messages for 24 hours, about 100 MB in the worst case and usually far less.
 */
export class LogMessageCache {
  private readonly messages = new ExpiringCache<string, CachedLogMessage>({
    clock: () => new Date(),
    maximumEntries: 50_000,
    ttlMilliseconds: 24 * 3_600_000,
  });

  public get size(): number {
    return this.messages.size;
  }

  public remember(messageId: string, message: CachedLogMessage): void {
    this.messages.set(messageId, {
      ...message,
      content: message.content.slice(0, maximumStoredLength),
    });
  }

  public get(messageId: string): CachedLogMessage | undefined {
    return this.messages.get(messageId);
  }

  public forget(messageId: string): CachedLogMessage | undefined {
    const message = this.messages.get(messageId);
    this.messages.delete(messageId);
    return message;
  }
}
