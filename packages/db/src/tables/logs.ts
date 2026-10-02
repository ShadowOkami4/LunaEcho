import { sql } from "drizzle-orm";
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

const timestamptz = (name: string) => timestamp(name, { mode: "date", withTimezone: true });

/** One optional log channel per category; a missing channel switches that category off. */
export const logSettings = pgTable("log_settings", {
  guildId: text("guild_id").primaryKey(),
  moderationChannelId: text("moderation_channel_id"),
  messageChannelId: text("message_channel_id"),
  memberChannelId: text("member_channel_id"),
  serverChannelId: text("server_channel_id"),
  voiceChannelId: text("voice_channel_id"),
  ignoredChannelIds: text("ignored_channel_ids")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  updatedBy: text("updated_by").notNull(),
  updatedAt: timestamptz("updated_at").notNull(),
});
