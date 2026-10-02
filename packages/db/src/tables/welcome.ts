import { sql } from "drizzle-orm";
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

const timestamptz = (name: string) => timestamp(name, { mode: "date", withTimezone: true });

/** A message is sent only when both its channel and its text are set. */
export const welcomeSettings = pgTable("welcome_settings", {
  guildId: text("guild_id").primaryKey(),
  welcomeChannelId: text("welcome_channel_id"),
  welcomeMessage: text("welcome_message"),
  goodbyeChannelId: text("goodbye_channel_id"),
  goodbyeMessage: text("goodbye_message"),
  directMessage: text("direct_message"),
  autoroleIds: text("autorole_ids")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  verificationChannelId: text("verification_channel_id"),
  verificationRoleId: text("verification_role_id"),
  verificationText: text("verification_text"),
  /** The posted verification panel, replaced when it is posted again. */
  verificationMessageId: text("verification_message_id"),
  updatedBy: text("updated_by").notNull(),
  updatedAt: timestamptz("updated_at").notNull(),
});
