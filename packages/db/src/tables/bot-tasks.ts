import { sql } from "drizzle-orm";
import { bigserial, index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

const timestamptz = (name: string) => timestamp(name, { mode: "date", withTimezone: true });

/**
 * Work the dashboard hands to the bot: posting panels into channels or telling it that settings
 * changed. The bot claims rows with SKIP LOCKED, so several bot processes never run one task twice.
 */
export const botTasks = pgTable(
  "bot_tasks",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    kind: text("kind").notNull(),
    guildId: text("guild_id").notNull(),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    claimedAt: timestamptz("claimed_at"),
    completedAt: timestamptz("completed_at"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
  },
  (table) => [index("bot_tasks_open_idx").on(table.completedAt, table.id)],
);
