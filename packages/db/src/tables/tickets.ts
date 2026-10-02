import { sql } from "drizzle-orm";
import {
  bigserial,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const timestamptz = (name: string) => timestamp(name, { mode: "date", withTimezone: true });

export const ticketSettings = pgTable("ticket_settings", {
  guildId: text("guild_id").primaryKey(),
  /** Tickets open as private threads below the panel's channel. */
  panelChannelId: text("panel_channel_id"),
  panelMessageId: text("panel_message_id"),
  panelTitle: text("panel_title"),
  panelText: text("panel_text"),
  staffRoleIds: text("staff_role_ids")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  /** Where transcripts of closed tickets are posted. */
  transcriptChannelId: text("transcript_channel_id"),
  maximumOpenPerMember: integer("maximum_open_per_member").notNull().default(1),
  updatedBy: text("updated_by").notNull(),
  updatedAt: timestamptz("updated_at").notNull(),
});

export const tickets = pgTable(
  "tickets",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    guildId: text("guild_id").notNull(),
    number: integer("number").notNull(),
    /** Null only while the thread is being created. */
    threadId: text("thread_id"),
    openerId: text("opener_id").notNull(),
    topic: text("topic").notNull(),
    status: text("status", { enum: ["open", "closed"] }).notNull(),
    claimedBy: text("claimed_by"),
    closedBy: text("closed_by"),
    closeReason: text("close_reason"),
    createdAt: timestamptz("created_at").notNull(),
    closedAt: timestamptz("closed_at"),
  },
  (table) => [
    uniqueIndex("tickets_guild_number_idx").on(table.guildId, table.number),
    uniqueIndex("tickets_thread_idx").on(table.threadId),
    index("tickets_opener_idx").on(table.guildId, table.openerId, table.status),
  ],
);
