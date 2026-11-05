import {
  boolean,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const timestamptz = (name: string) => timestamp(name, { mode: "date", withTimezone: true });

/**
 * How many Custom bots a Discord user may run. Granted by an operator until billing exists.
 * These platform tables live in the central (Cloud) database only.
 */
export const customBotGrants = pgTable("custom_bot_grants", {
  userId: text("user_id").primaryKey(),
  slots: integer("slots").notNull(),
  note: text("note"),
  /** A partner grant is free and never billed, for example for the operator's own servers. */
  partner: boolean("partner").notNull().default(false),
  grantedBy: text("granted_by").notNull(),
  updatedAt: timestamptz("updated_at").notNull(),
});

/**
 * A customer's own bot. The dashboard sets the desired state; the orchestrator, the only part
 * allowed to start containers, works towards it and reports the actual status back.
 */
export const customBots = pgTable(
  "custom_bots",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id").notNull(),
    applicationId: text("application_id").notNull(),
    botUserId: text("bot_user_id").notNull(),
    name: text("name").notNull(),
    avatarHash: text("avatar_hash"),
    /** The bot token, sealed with AES-256-GCM; the key never touches the database. */
    sealedToken: text("sealed_token").notNull(),
    /** Each customer gets an own database, so settings never mix with other bots. */
    databaseName: text("database_name").notNull(),
    desiredState: text("desired_state", { enum: ["running", "stopped", "deleted"] }).notNull(),
    status: text("status", {
      enum: ["pending", "starting", "running", "stopped", "failed", "deleted"],
    }).notNull(),
    statusMessage: text("status_message"),
    createdAt: timestamptz("created_at").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("custom_bots_application_idx").on(table.applicationId),
    uniqueIndex("custom_bots_database_idx").on(table.databaseName),
    index("custom_bots_owner_idx").on(table.ownerUserId),
  ],
);

/**
 * One reading a day per running Custom bot: how many servers it is in and their members added
 * up, as Discord reports them. Billing uses the 30-day average, so short spikes barely count and
 * days a bot was stopped count as zero. Rows keep the owner, so they outlive a removed bot.
 */
export const customBotUsage = pgTable(
  "custom_bot_usage",
  {
    botId: text("bot_id").notNull(),
    ownerUserId: text("owner_user_id").notNull(),
    day: date("day", { mode: "string" }).notNull(),
    guildCount: integer("guild_count").notNull(),
    memberCount: integer("member_count").notNull(),
    measuredAt: timestamptz("measured_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.botId, table.day] }),
    index("custom_bot_usage_owner_day_idx").on(table.ownerUserId, table.day),
  ],
);
