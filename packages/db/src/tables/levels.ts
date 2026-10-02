import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

const timestamptz = (name: string) => timestamp(name, { mode: "date", withTimezone: true });

export const levelSettings = pgTable(
  "level_settings",
  {
    guildId: text("guild_id").primaryKey(),
    messageXpMin: integer("message_xp_min").notNull().default(15),
    messageXpMax: integer("message_xp_max").notNull().default(25),
    messageCooldownSeconds: integer("message_cooldown_seconds").notNull().default(60),
    voiceXpPerMinute: integer("voice_xp_per_minute").notNull().default(10),
    announceMode: text("announce_mode").notNull().default("current"),
    announceChannelId: text("announce_channel_id"),
    announceTemplate: text("announce_template").notNull().default("{user} reached level {level}!"),
    stackRewards: boolean("stack_rewards").notNull().default(true),
    ignoredChannelIds: text("ignored_channel_ids")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    ignoredRoleIds: text("ignored_role_ids")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    updatedBy: text("updated_by").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [
    check(
      "level_settings_xp_range_check",
      sql`${table.messageXpMin} BETWEEN 0 AND 1000 AND ${table.messageXpMax} BETWEEN ${table.messageXpMin} AND 1000`,
    ),
    check("level_settings_cooldown_check", sql`${table.messageCooldownSeconds} BETWEEN 0 AND 3600`),
    check("level_settings_voice_check", sql`${table.voiceXpPerMinute} BETWEEN 0 AND 1000`),
    check(
      "level_settings_announce_mode_check",
      sql`${table.announceMode} IN ('off', 'current', 'channel')`,
    ),
  ],
);

/** A role granted on reaching a level; one role per level. */
export const levelRewards = pgTable(
  "level_rewards",
  {
    guildId: text("guild_id").notNull(),
    level: integer("level").notNull(),
    roleId: text("role_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.guildId, table.level] }),
    check("level_rewards_level_check", sql`${table.level} BETWEEN 1 AND 1000`),
  ],
);

export const memberLevels = pgTable(
  "member_levels",
  {
    guildId: text("guild_id").notNull(),
    userId: text("user_id").notNull(),
    xp: bigint("xp", { mode: "number" }).notNull().default(0),
    messageCount: integer("message_count").notNull().default(0),
    voiceMinutes: integer("voice_minutes").notNull().default(0),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.guildId, table.userId] }),
    index("member_levels_leaderboard_idx").on(table.guildId, table.xp.desc()),
  ],
);
