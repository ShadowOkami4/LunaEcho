import { bigserial, check, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const timestamptz = (name: string) => timestamp(name, { mode: "date", withTimezone: true });

/** Reminders survive restarts; the bot delivers and deletes them once they are due. */
export const reminders = pgTable(
  "reminders",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    guildId: text("guild_id").notNull(),
    channelId: text("channel_id").notNull(),
    userId: text("user_id").notNull(),
    text: text("text").notNull(),
    dueAt: timestamptz("due_at").notNull(),
    createdAt: timestamptz("created_at").notNull(),
  },
  (table) => [
    index("reminders_due_idx").on(table.dueAt),
    index("reminders_owner_idx").on(table.guildId, table.userId),
    check("reminders_text_length_check", sql`char_length(${table.text}) BETWEEN 1 AND 500`),
  ],
);
