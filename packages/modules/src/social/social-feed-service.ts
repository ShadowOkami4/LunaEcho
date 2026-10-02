import { randomUUID } from "node:crypto";

import type { Clock } from "@lunaecho/core";
import { socialFeeds, type LunaDatabase } from "@lunaecho/db";
import { and, asc, count, eq, inArray, lte, sql } from "drizzle-orm";

import type { SocialItem } from "./social-sources.js";

export const maximumSocialFeedsPerGuild = 10;
export const socialCheckIntervalMilliseconds = {
  twitch: 2 * 60_000,
  youtube: 5 * 60_000,
} as const;
/** Never announce more than this many items from one check, so a backlog cannot flood a channel. */
export const maximumItemsPerCheck = 3;

export type SocialPlatform = "twitch" | "youtube";

export type SocialFeed = Readonly<{
  channelId: string;
  displayName: string;
  guildId: string;
  id: string;
  lastItemId: string | null;
  message: string | null;
  pingRoleId: string | null;
  platform: SocialPlatform;
  sourceId: string;
}>;

export type SocialFeedInput = Omit<SocialFeed, "id" | "lastItemId">;

export class SocialFeedInputError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "SocialFeedInputError";
  }
}

export const defaultSocialMessages = {
  twitch: "🔴 **{creator}** is live: {title}\n{url}",
  youtube: "📺 **{creator}** posted a new video: {title}\n{url}",
} as const satisfies Readonly<Record<SocialPlatform, string>>;

export function renderSocialMessage(feed: SocialFeed, item: SocialItem): string {
  return (feed.message ?? defaultSocialMessages[feed.platform])
    .replaceAll("{creator}", item.creatorName)
    .replaceAll("{title}", item.title)
    .replaceAll("{url}", item.url);
}

/**
 * Picks what to announce from the newest-first item list. The first check only remembers the
 * newest item, so adding a feed never posts old videos.
 */
export function selectNewItems(
  lastItemId: string | null,
  items: readonly SocialItem[],
): Readonly<{ announce: SocialItem[]; newest: string | null }> {
  const newest = items[0]?.id ?? lastItemId;

  if (lastItemId === null) {
    return { announce: [], newest };
  }

  const known = items.findIndex((item) => item.id === lastItemId);
  // When the last item fell out of the feed, only the newest is announced.
  const fresh = known === -1 ? items.slice(0, 1) : items.slice(0, known);
  return { announce: fresh.slice(0, maximumItemsPerCheck).reverse(), newest };
}

function toFeed(row: typeof socialFeeds.$inferSelect): SocialFeed {
  return {
    channelId: row.channelId,
    displayName: row.displayName,
    guildId: row.guildId,
    id: row.id,
    lastItemId: row.lastItemId,
    message: row.message,
    pingRoleId: row.pingRoleId,
    platform: row.platform,
    sourceId: row.sourceId,
  };
}

export class SocialFeedService {
  public constructor(
    private readonly database: LunaDatabase,
    private readonly clock: Clock = () => new Date(),
  ) {}

  public async list(guildId: string): Promise<SocialFeed[]> {
    const rows = await this.database
      .select()
      .from(socialFeeds)
      .where(eq(socialFeeds.guildId, guildId))
      .orderBy(asc(socialFeeds.platform), asc(socialFeeds.displayName));
    return rows.map(toFeed);
  }

  public async add(input: SocialFeedInput, actorId: string): Promise<SocialFeed> {
    const message = input.message?.trim() ?? "";

    if (message.length > 1_000) {
      throw new SocialFeedInputError("The message can have at most 1,000 characters.");
    }

    const [existing] = await this.database
      .select({ value: count() })
      .from(socialFeeds)
      .where(eq(socialFeeds.guildId, input.guildId));

    if ((existing?.value ?? 0) >= maximumSocialFeedsPerGuild) {
      throw new SocialFeedInputError(
        `A server can follow at most ${maximumSocialFeedsPerGuild} creators.`,
      );
    }

    const feed: SocialFeed = {
      ...input,
      id: randomUUID(),
      lastItemId: null,
      message: message.length === 0 ? null : message,
    };
    const rows = await this.database
      .insert(socialFeeds)
      .values({
        ...feed,
        nextCheckAt: this.clock(),
        updatedAt: this.clock(),
        updatedBy: actorId,
      })
      .onConflictDoNothing()
      .returning({ id: socialFeeds.id });

    if (rows.length === 0) {
      throw new SocialFeedInputError("This server already follows that creator.");
    }

    return feed;
  }

  public async remove(guildId: string, feedId: string): Promise<void> {
    await this.database
      .delete(socialFeeds)
      .where(and(eq(socialFeeds.guildId, guildId), eq(socialFeeds.id, feedId)));
  }

  /** Claims due feeds and schedules their next check in one statement. */
  public async takeDue(platform: SocialPlatform, limit = 200): Promise<SocialFeed[]> {
    const now = this.clock();
    const due = this.database
      .select({ id: socialFeeds.id })
      .from(socialFeeds)
      .where(and(eq(socialFeeds.platform, platform), lte(socialFeeds.nextCheckAt, now)))
      .orderBy(asc(socialFeeds.nextCheckAt))
      .limit(limit)
      .for("update", { skipLocked: true });
    // Failing feeds back off up to an hour, so a deleted channel does not cost a request a minute.
    const rows = await this.database
      .update(socialFeeds)
      .set({
        nextCheckAt: sql`${now.toISOString()}::timestamptz + least(interval '1 hour', ${`${socialCheckIntervalMilliseconds[platform]} milliseconds`}::interval * power(2, ${socialFeeds.failures}))`,
      })
      .where(inArray(socialFeeds.id, due))
      .returning();
    return rows.map(toFeed);
  }

  public async recordSuccess(feedId: string, lastItemId: string | null): Promise<void> {
    await this.database
      .update(socialFeeds)
      .set({ failures: 0, lastItemId })
      .where(eq(socialFeeds.id, feedId));
  }

  public async recordFailure(feedId: string): Promise<void> {
    await this.database
      .update(socialFeeds)
      .set({ failures: sql`least(${socialFeeds.failures} + 1, 6)` })
      .where(eq(socialFeeds.id, feedId));
  }
}
