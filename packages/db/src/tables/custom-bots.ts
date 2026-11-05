import {
  boolean,
  index,
  integer,
  pgTable,
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
