import { index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

const timestamptz = (name: string) => timestamp(name, { mode: "date", withTimezone: true });

/** A creator a guild follows. The poller claims feeds by moving next_check_at forward. */
export const socialFeeds = pgTable(
  "social_feeds",
  {
    id: text("id").primaryKey(),
    guildId: text("guild_id").notNull(),
    platform: text("platform", { enum: ["twitch", "youtube"] }).notNull(),
    /** YouTube channel id (UC…) or Twitch login. */
    sourceId: text("source_id").notNull(),
    displayName: text("display_name").notNull(),
    channelId: text("channel_id").notNull(),
    pingRoleId: text("ping_role_id"),
    message: text("message"),
    /** The newest video or stream already announced; null until the first check. */
    lastItemId: text("last_item_id"),
    nextCheckAt: timestamptz("next_check_at").notNull(),
    failures: integer("failures").notNull().default(0),
    updatedBy: text("updated_by").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("social_feeds_source_idx").on(table.guildId, table.platform, table.sourceId),
    index("social_feeds_next_check_idx").on(table.nextCheckAt),
  ],
);
