import { ExpiringCache, type Clock } from "@lunaecho/core";
import { ticketSettings, tickets, type LunaDatabase } from "@lunaecho/db";
import { and, count, eq, max, sql } from "drizzle-orm";

export const maximumTicketStaffRoles = 10;
export const maximumOpenTicketsPerMemberLimit = 5;
export const maximumTicketTopicLength = 500;

export type TicketSettings = Readonly<{
  guildId: string;
  maximumOpenPerMember: number;
  panelChannelId: string | null;
  panelMessageId: string | null;
  panelText: string | null;
  panelTitle: string | null;
  staffRoleIds: readonly string[];
  transcriptChannelId: string | null;
}>;

export type Ticket = Readonly<{
  claimedBy: string | null;
  closeReason: string | null;
  closedBy: string | null;
  createdAt: Date;
  guildId: string;
  id: number;
  number: number;
  openerId: string;
  status: "closed" | "open";
  threadId: string | null;
  topic: string;
}>;

export type OpenTicketResult =
  | Readonly<{ kind: "opened"; ticket: Ticket }>
  | Readonly<{ kind: "invalid-topic" | "not-configured" }>
  | Readonly<{ kind: "too-many"; open: readonly Ticket[] }>;

export class TicketSettingsInputError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "TicketSettingsInputError";
  }
}

function defaultsFor(guildId: string): TicketSettings {
  return {
    guildId,
    maximumOpenPerMember: 1,
    panelChannelId: null,
    panelMessageId: null,
    panelText: null,
    panelTitle: null,
    staffRoleIds: [],
    transcriptChannelId: null,
  };
}

function toTicket(row: typeof tickets.$inferSelect): Ticket {
  return {
    claimedBy: row.claimedBy,
    closeReason: row.closeReason,
    closedBy: row.closedBy,
    createdAt: row.createdAt,
    guildId: row.guildId,
    id: row.id,
    number: row.number,
    openerId: row.openerId,
    status: row.status,
    threadId: row.threadId,
    topic: row.topic,
  };
}

export class TicketService {
  private readonly settingsCache: ExpiringCache<string, TicketSettings>;

  public constructor(
    private readonly database: LunaDatabase,
    private readonly clock: Clock = () => new Date(),
  ) {
    this.settingsCache = new ExpiringCache({
      clock,
      maximumEntries: 10_000,
      ttlMilliseconds: 60_000,
    });
  }

  public invalidate(guildId: string): void {
    this.settingsCache.delete(guildId);
  }

  public async getSettings(guildId: string): Promise<TicketSettings> {
    const cached = this.settingsCache.get(guildId);

    if (cached !== undefined) {
      return cached;
    }

    const [row] = await this.database
      .select()
      .from(ticketSettings)
      .where(eq(ticketSettings.guildId, guildId));
    const settings: TicketSettings =
      row === undefined
        ? defaultsFor(guildId)
        : {
            guildId,
            maximumOpenPerMember: row.maximumOpenPerMember,
            panelChannelId: row.panelChannelId,
            panelMessageId: row.panelMessageId,
            panelText: row.panelText,
            panelTitle: row.panelTitle,
            staffRoleIds: row.staffRoleIds,
            transcriptChannelId: row.transcriptChannelId,
          };
    this.settingsCache.set(guildId, settings);
    return settings;
  }

  /** Saves everything except the posted panel's message id, which only the bot sets. */
  public async saveSettings(input: TicketSettings, actorId: string): Promise<TicketSettings> {
    const staffRoleIds = [...new Set(input.staffRoleIds)];
    const panelTitle = input.panelTitle?.trim() ?? "";
    const panelText = input.panelText?.trim() ?? "";

    if (staffRoleIds.length > maximumTicketStaffRoles) {
      throw new TicketSettingsInputError(
        `At most ${maximumTicketStaffRoles} staff roles are allowed.`,
      );
    }

    if (
      !Number.isInteger(input.maximumOpenPerMember) ||
      input.maximumOpenPerMember < 1 ||
      input.maximumOpenPerMember > maximumOpenTicketsPerMemberLimit
    ) {
      throw new TicketSettingsInputError(
        `Members can have 1 to ${maximumOpenTicketsPerMemberLimit} open tickets.`,
      );
    }

    if (panelTitle.length > 100 || panelText.length > 1_500) {
      throw new TicketSettingsInputError("The panel title or text is too long.");
    }

    const settings: TicketSettings = {
      ...input,
      panelText: panelText.length === 0 ? null : panelText,
      panelTitle: panelTitle.length === 0 ? null : panelTitle,
      staffRoleIds,
    };
    const values = {
      maximumOpenPerMember: settings.maximumOpenPerMember,
      panelChannelId: settings.panelChannelId,
      panelText: settings.panelText,
      panelTitle: settings.panelTitle,
      staffRoleIds,
      transcriptChannelId: settings.transcriptChannelId,
      updatedAt: this.clock(),
      updatedBy: actorId,
    };
    await this.database
      .insert(ticketSettings)
      .values({ ...values, guildId: settings.guildId })
      .onConflictDoUpdate({ set: values, target: ticketSettings.guildId });
    this.settingsCache.delete(settings.guildId);
    return settings;
  }

  public async setPanelMessage(guildId: string, messageId: string | null): Promise<void> {
    await this.database
      .update(ticketSettings)
      .set({ panelMessageId: messageId })
      .where(eq(ticketSettings.guildId, guildId));
    this.settingsCache.delete(guildId);
  }

  /**
   * Reserves a ticket number. The caller creates the thread and then calls attachThread, or
   * discard when Discord refused to create it.
   */
  public async open(
    input: Readonly<{ guildId: string; openerId: string; topic: string }>,
  ): Promise<OpenTicketResult> {
    const topic = input.topic.trim();

    if (topic.length === 0 || topic.length > maximumTicketTopicLength) {
      return { kind: "invalid-topic" };
    }

    const settings = await this.getSettings(input.guildId);

    if (settings.panelChannelId === null) {
      return { kind: "not-configured" };
    }

    return this.database.transaction(async (transaction) => {
      // One lock per guild keeps both the member limit and the numbering exact.
      await transaction.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`tickets:${input.guildId}`}))`,
      );
      const open = await transaction
        .select()
        .from(tickets)
        .where(
          and(
            eq(tickets.guildId, input.guildId),
            eq(tickets.openerId, input.openerId),
            eq(tickets.status, "open"),
          ),
        );

      if (open.length >= settings.maximumOpenPerMember) {
        return { kind: "too-many", open: open.map(toTicket) } as const;
      }

      const [last] = await transaction
        .select({ value: max(tickets.number) })
        .from(tickets)
        .where(eq(tickets.guildId, input.guildId));
      const [row] = await transaction
        .insert(tickets)
        .values({
          createdAt: this.clock(),
          guildId: input.guildId,
          number: (last?.value ?? 0) + 1,
          openerId: input.openerId,
          status: "open",
          topic,
        })
        .returning();

      if (row === undefined) {
        throw new Error("Ticket insert returned no row");
      }

      return { kind: "opened", ticket: toTicket(row) } as const;
    });
  }

  public async attachThread(ticketId: number, threadId: string): Promise<void> {
    await this.database.update(tickets).set({ threadId }).where(eq(tickets.id, ticketId));
  }

  public async discard(ticketId: number): Promise<void> {
    await this.database.delete(tickets).where(eq(tickets.id, ticketId));
  }

  public async findByThread(threadId: string): Promise<Ticket | undefined> {
    const [row] = await this.database.select().from(tickets).where(eq(tickets.threadId, threadId));
    return row === undefined ? undefined : toTicket(row);
  }

  /** Returns false when the ticket is closed or someone else claimed it first. */
  public async claim(ticketId: number, staffId: string): Promise<boolean> {
    const rows = await this.database
      .update(tickets)
      .set({ claimedBy: staffId })
      .where(
        and(
          eq(tickets.id, ticketId),
          eq(tickets.status, "open"),
          sql`${tickets.claimedBy} IS NULL`,
        ),
      )
      .returning({ id: tickets.id });
    return rows.length > 0;
  }

  /** Returns the closed ticket, or undefined when it was already closed. */
  public async close(
    ticketId: number,
    closerId: string,
    reason: string | null,
  ): Promise<Ticket | undefined> {
    const trimmed = reason?.trim().slice(0, maximumTicketTopicLength) ?? "";
    const [row] = await this.database
      .update(tickets)
      .set({
        closeReason: trimmed.length === 0 ? null : trimmed,
        closedAt: this.clock(),
        closedBy: closerId,
        status: "closed",
      })
      .where(and(eq(tickets.id, ticketId), eq(tickets.status, "open")))
      .returning();
    return row === undefined ? undefined : toTicket(row);
  }

  public async countOpen(guildId: string): Promise<number> {
    const [row] = await this.database
      .select({ value: count() })
      .from(tickets)
      .where(and(eq(tickets.guildId, guildId), eq(tickets.status, "open")));
    return row?.value ?? 0;
  }
}
