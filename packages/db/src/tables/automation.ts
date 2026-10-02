import { boolean, index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

const timestamptz = (name: string) => timestamp(name, { mode: "date", withTimezone: true });

/** Rules are validated by the AutomationService; the JSON columns hold its types. */
export const automationRules = pgTable(
  "automation_rules",
  {
    id: text("id").primaryKey(),
    guildId: text("guild_id").notNull(),
    name: text("name").notNull(),
    enabled: boolean("enabled").notNull(),
    trigger: jsonb("trigger").notNull(),
    conditions: jsonb("conditions").notNull(),
    actions: jsonb("actions").notNull(),
    cooldownSeconds: integer("cooldown_seconds").notNull(),
    /** Only scheduled rules have this; the scheduler claims rules by moving it forward. */
    nextRunAt: timestamptz("next_run_at"),
    updatedBy: text("updated_by").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [
    index("automation_rules_guild_idx").on(table.guildId),
    index("automation_rules_next_run_idx").on(table.nextRunAt),
  ],
);
