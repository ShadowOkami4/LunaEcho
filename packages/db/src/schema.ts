import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

const timestamptz = (name: string) => timestamp(name, { mode: "date", withTimezone: true });

/**
 * Per-guild module switches. A missing row means the module still uses its default state, so
 * disabling a module never deletes that module's own settings.
 */
export const guildModules = pgTable(
  "guild_modules",
  {
    guildId: text("guild_id").notNull(),
    moduleId: text("module_id").notNull(),
    enabled: boolean("enabled").notNull(),
    updatedBy: text("updated_by").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.guildId, table.moduleId] })],
);

export const guildModerationSettings = pgTable(
  "guild_moderation_settings",
  {
    guildId: text("guild_id").primaryKey(),
    bannedWordsEnabled: boolean("banned_words_enabled").notNull().default(false),
    automodProfile: text("automod_profile").notNull().default("off"),
    staffExempt: boolean("staff_exempt").notNull().default(true),
    dmNotificationsEnabled: boolean("dm_notifications_enabled").notNull().default(true),
    createdAt: timestamptz("created_at").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [
    check(
      "guild_moderation_settings_automod_profile_check",
      sql`${table.automodProfile} IN ('off', 'relaxed', 'balanced', 'strict', 'custom')`,
    ),
  ],
);

export const guildBannedWords = pgTable(
  "guild_banned_words",
  {
    guildId: text("guild_id").notNull(),
    normalizedWord: text("normalized_word").notNull(),
    displayWord: text("display_word").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: timestamptz("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.guildId, table.normalizedWord] }),
    foreignKey({
      columns: [table.guildId],
      foreignColumns: [guildModerationSettings.guildId],
    }).onDelete("cascade"),
    index("guild_banned_words_created_at_idx").on(table.guildId, table.createdAt),
  ],
);

export const guildModerationCaseCounters = pgTable(
  "guild_moderation_case_counters",
  {
    guildId: text("guild_id").primaryKey(),
    nextCaseNumber: integer("next_case_number").notNull().default(1),
  },
  (table) => [
    check("guild_moderation_case_counters_next_check", sql`${table.nextCaseNumber} >= 1`),
  ],
);

export const guildModerationCases = pgTable(
  "guild_moderation_cases",
  {
    guildId: text("guild_id").notNull(),
    caseNumber: integer("case_number").notNull(),
    action: text("action").notNull(),
    status: text("status").notNull(),
    targetUserId: text("target_user_id"),
    moderatorUserId: text("moderator_user_id").notNull(),
    reason: text("reason").notNull(),
    durationSeconds: integer("duration_seconds"),
    failureCode: text("failure_code"),
    createdAt: timestamptz("created_at").notNull(),
    completedAt: timestamptz("completed_at"),
  },
  (table) => [
    primaryKey({ columns: [table.guildId, table.caseNumber] }),
    check("guild_moderation_cases_case_number_check", sql`${table.caseNumber} >= 1`),
    check(
      "guild_moderation_cases_action_check",
      sql`${table.action} IN ('warn', 'timeout', 'untimeout', 'kick', 'ban', 'unban', 'purge', 'automod')`,
    ),
    check(
      "guild_moderation_cases_status_check",
      sql`${table.status} IN ('pending', 'completed', 'failed')`,
    ),
    check(
      "guild_moderation_cases_duration_check",
      sql`${table.durationSeconds} IS NULL OR ${table.durationSeconds} > 0`,
    ),
    index("guild_moderation_cases_target_idx").on(
      table.guildId,
      table.targetUserId,
      table.caseNumber.desc(),
    ),
    index("guild_moderation_cases_status_idx").on(
      table.guildId,
      table.status,
      table.caseNumber.desc(),
    ),
  ],
);

export const guildAutomodRules = pgTable(
  "guild_automod_rules",
  {
    guildId: text("guild_id").notNull(),
    ruleKind: text("rule_kind").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    action: text("action").notNull().default("log-only"),
    triggerLimit: integer("trigger_limit").notNull().default(1),
    secondaryLimit: integer("secondary_limit"),
    windowSeconds: integer("window_seconds"),
    timeoutSeconds: integer("timeout_seconds").notNull().default(600),
    updatedBy: text("updated_by").notNull(),
    createdAt: timestamptz("created_at").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.guildId, table.ruleKind] }),
    foreignKey({
      columns: [table.guildId],
      foreignColumns: [guildModerationSettings.guildId],
    }).onDelete("cascade"),
    check(
      "guild_automod_rules_rule_kind_check",
      sql`${table.ruleKind} IN ('message-flood', 'cross-channel-spam', 'mention-spam', 'attachment-spam', 'emoji-spam', 'large-message', 'excessive-caps', 'invite-links', 'polls', 'threats-and-identity-attacks')`,
    ),
    check(
      "guild_automod_rules_action_check",
      sql`${table.action} IN ('log-only', 'delete', 'delete-and-warn', 'delete-and-timeout')`,
    ),
    check("guild_automod_rules_trigger_limit_check", sql`${table.triggerLimit} > 0`),
    check(
      "guild_automod_rules_secondary_limit_check",
      sql`${table.secondaryLimit} IS NULL OR ${table.secondaryLimit} > 0`,
    ),
    check(
      "guild_automod_rules_window_seconds_check",
      sql`${table.windowSeconds} IS NULL OR ${table.windowSeconds} > 0`,
    ),
    check(
      "guild_automod_rules_timeout_seconds_check",
      sql`${table.timeoutSeconds} BETWEEN 300 AND 86400`,
    ),
    index("guild_automod_rules_enabled_idx").on(table.guildId, table.enabled),
  ],
);

/** A join-to-create channel: joining it creates a new voice room for the member. */
export const voiceRoomLobbies = pgTable(
  "voice_room_lobbies",
  {
    guildId: text("guild_id").notNull(),
    channelId: text("channel_id").notNull(),
    categoryId: text("category_id"),
    nameTemplate: text("name_template").notNull(),
    userLimit: integer("user_limit").notNull().default(0),
    createdBy: text("created_by").notNull(),
    createdAt: timestamptz("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.guildId, table.channelId] }),
    check("voice_room_lobbies_user_limit_check", sql`${table.userLimit} BETWEEN 0 AND 99`),
  ],
);

/** A voice room LunaEcho created and must delete once it is empty. */
export const voiceRooms = pgTable(
  "voice_rooms",
  {
    channelId: text("channel_id").primaryKey(),
    guildId: text("guild_id").notNull(),
    ownerId: text("owner_id").notNull(),
    lobbyChannelId: text("lobby_channel_id").notNull(),
    createdAt: timestamptz("created_at").notNull(),
  },
  (table) => [index("voice_rooms_guild_owner_idx").on(table.guildId, table.ownerId)],
);

export const guildMusicSettings = pgTable(
  "guild_music_settings",
  {
    guildId: text("guild_id").primaryKey(),
    djRoleId: text("dj_role_id"),
    defaultVolume: integer("default_volume").notNull().default(80),
    updatedBy: text("updated_by").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [
    check(
      "guild_music_settings_default_volume_check",
      sql`${table.defaultVolume} BETWEEN 0 AND 150`,
    ),
  ],
);

export const guildAutomodExemptions = pgTable(
  "guild_automod_exemptions",
  {
    guildId: text("guild_id").notNull(),
    targetKind: text("target_kind").notNull(),
    targetId: text("target_id").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: timestamptz("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.guildId, table.targetKind, table.targetId] }),
    foreignKey({
      columns: [table.guildId],
      foreignColumns: [guildModerationSettings.guildId],
    }).onDelete("cascade"),
    check(
      "guild_automod_exemptions_target_kind_check",
      sql`${table.targetKind} IN ('channel', 'role')`,
    ),
  ],
);

export * from "./tables/bot-tasks.js";
export * from "./tables/reminders.js";
export * from "./tables/levels.js";
export * from "./tables/logs.js";
export * from "./tables/welcome.js";
export * from "./tables/roles.js";
export * from "./tables/tickets.js";
export * from "./tables/automation.js";
export * from "./tables/social.js";
export * from "./tables/welcome-cards.js";
export * from "./tables/custom-bots.js";
