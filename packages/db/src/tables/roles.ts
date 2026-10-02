import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

const timestamptz = (name: string) => timestamp(name, { mode: "date", withTimezone: true });

export interface RoleMenuOptionRow {
  description: string | null;
  emoji: string | null;
  label: string;
  roleId: string;
}

/** A self-assignable role menu, built in the dashboard and posted by the bot. */
export const roleMenus = pgTable(
  "role_menus",
  {
    id: text("id").primaryKey(),
    guildId: text("guild_id").notNull(),
    channelId: text("channel_id").notNull(),
    /** The posted message, replaced when the menu is posted again. */
    messageId: text("message_id"),
    title: text("title").notNull(),
    description: text("description").notNull(),
    style: text("style", { enum: ["buttons", "select"] }).notNull(),
    mode: text("mode", { enum: ["multiple", "single"] }).notNull(),
    options: jsonb("options").$type<RoleMenuOptionRow[]>().notNull(),
    updatedBy: text("updated_by").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [index("role_menus_guild_idx").on(table.guildId)],
);
