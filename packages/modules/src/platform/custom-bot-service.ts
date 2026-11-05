import { randomUUID } from "node:crypto";

import type { Clock } from "@lunaecho/core";
import { customBotGrants, customBots, type LunaDatabase } from "@lunaecho/db";
import { and, asc, count, desc, eq, inArray, ne, sql } from "drizzle-orm";

import type { BotTokenInspection } from "./bot-token-inspection.js";
import type { TokenVault } from "./token-vault.js";

export type CustomBotStatus = (typeof customBots.$inferSelect)["status"];
export type CustomBotDesiredState = (typeof customBots.$inferSelect)["desiredState"];

/** A Custom bot as the dashboard shows it; the sealed token never leaves the service. */
export type CustomBot = Readonly<{
  applicationId: string;
  avatarHash: string | null;
  botUserId: string;
  createdAt: Date;
  desiredState: CustomBotDesiredState;
  id: string;
  name: string;
  ownerUserId: string;
  status: CustomBotStatus;
  statusMessage: string | null;
}>;

/** What the orchestrator needs to run a bot. */
export type CustomBotDeployment = CustomBot &
  Readonly<{ databaseName: string; sealedToken: string; updatedAt: Date }>;

export class CustomBotError extends Error {
  public constructor(
    public readonly reason:
      "already-registered" | "different-application" | "no-slot" | "not-found",
    message: string,
  ) {
    super(message);
    this.name = "CustomBotError";
  }
}

export const maximumCustomBotSlots = 10;

/** A user's Custom allowance. Partner grants are free and never shown in pricing. */
export type CustomBotGrant = Readonly<{ partner: boolean; slots: number; used: number }>;

function toBot(row: typeof customBots.$inferSelect): CustomBot {
  return {
    applicationId: row.applicationId,
    avatarHash: row.avatarHash,
    botUserId: row.botUserId,
    createdAt: row.createdAt,
    desiredState: row.desiredState,
    id: row.id,
    name: row.name,
    ownerUserId: row.ownerUserId,
    status: row.status,
    statusMessage: row.statusMessage,
  };
}

/**
 * Custom bots in the central database. The dashboard only records what a customer wants; the
 * orchestrator reads it and is the only part that starts or stops containers.
 */
export class CustomBotService {
  public constructor(
    private readonly database: LunaDatabase,
    private readonly vault: TokenVault,
    private readonly clock: Clock = () => new Date(),
  ) {}

  // ─── Grants ──────────────────────────────────────────────────────────────

  public async slotsFor(userId: string): Promise<number> {
    const [row] = await this.database
      .select({ slots: customBotGrants.slots })
      .from(customBotGrants)
      .where(eq(customBotGrants.userId, userId));
    return row?.slots ?? 0;
  }

  /** The user's slots and how many are taken; no grant means no slots. */
  public async grantFor(userId: string): Promise<CustomBotGrant> {
    const [[grant], [owned]] = await Promise.all([
      this.database
        .select({ partner: customBotGrants.partner, slots: customBotGrants.slots })
        .from(customBotGrants)
        .where(eq(customBotGrants.userId, userId)),
      this.database
        .select({ value: count() })
        .from(customBots)
        .where(and(eq(customBots.ownerUserId, userId), ne(customBots.desiredState, "deleted"))),
    ]);
    return {
      partner: grant?.partner ?? false,
      slots: grant?.slots ?? 0,
      used: owned?.value ?? 0,
    };
  }

  public async grant(
    userId: string,
    slots: number,
    actorId: string,
    note: string | null = null,
    partner = false,
  ): Promise<void> {
    if (!Number.isInteger(slots) || slots < 0 || slots > maximumCustomBotSlots) {
      throw new RangeError(`Slots must be between 0 and ${maximumCustomBotSlots}.`);
    }

    const values = { grantedBy: actorId, note, partner, slots, updatedAt: this.clock() };
    await this.database.transaction(async (transaction) => {
      await transaction.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`custom-bots:${userId}`}))`,
      );
      await transaction
        .insert(customBotGrants)
        .values({ ...values, userId })
        .onConflictDoUpdate({ set: values, target: customBotGrants.userId });

      // Fewer slots than running bots, for example after a cancelled subscription: the newest
      // bots stop. They keep their settings and start again once slots are back.
      const running = await transaction
        .select({ id: customBots.id })
        .from(customBots)
        .where(and(eq(customBots.ownerUserId, userId), eq(customBots.desiredState, "running")))
        .orderBy(desc(customBots.createdAt));
      const excess = running.slice(0, Math.max(running.length - slots, 0));

      if (excess.length > 0) {
        await transaction
          .update(customBots)
          .set({ desiredState: "stopped", updatedAt: this.clock() })
          .where(
            inArray(
              customBots.id,
              excess.map((bot) => bot.id),
            ),
          );
      }
    });
  }

  public async listGrants(): Promise<
    readonly Readonly<{
      note: string | null;
      partner: boolean;
      slots: number;
      used: number;
      userId: string;
    }>[]
  > {
    const grants = await this.database
      .select()
      .from(customBotGrants)
      .orderBy(asc(customBotGrants.userId));
    const used = await this.database
      .select({ ownerUserId: customBots.ownerUserId, value: count() })
      .from(customBots)
      .where(ne(customBots.desiredState, "deleted"))
      .groupBy(customBots.ownerUserId);
    const usedBy = new Map(used.map((row) => [row.ownerUserId, row.value]));
    return grants.map((grant) => ({
      note: grant.note,
      partner: grant.partner,
      slots: grant.slots,
      used: usedBy.get(grant.userId) ?? 0,
      userId: grant.userId,
    }));
  }

  // ─── Customers ───────────────────────────────────────────────────────────

  public async listOwned(ownerUserId: string): Promise<CustomBot[]> {
    const rows = await this.database
      .select()
      .from(customBots)
      .where(and(eq(customBots.ownerUserId, ownerUserId), ne(customBots.desiredState, "deleted")))
      .orderBy(asc(customBots.createdAt));
    return rows.map(toBot);
  }

  public async getOwned(ownerUserId: string, botId: string): Promise<CustomBot> {
    const [row] = await this.database
      .select()
      .from(customBots)
      .where(
        and(
          eq(customBots.id, botId),
          eq(customBots.ownerUserId, ownerUserId),
          ne(customBots.desiredState, "deleted"),
        ),
      );

    if (row === undefined) {
      throw new CustomBotError("not-found", "This bot does not exist.");
    }

    return toBot(row);
  }

  /** Registers a bot whose token Discord has just confirmed, and asks for it to be started. */
  public async create(
    ownerUserId: string,
    token: string,
    inspection: BotTokenInspection,
  ): Promise<CustomBot> {
    return this.database.transaction(async (transaction) => {
      // Serializes creation per owner, so two quick submissions cannot exceed the slots.
      await transaction.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`custom-bots:${ownerUserId}`}))`,
      );
      const [grant] = await transaction
        .select({ slots: customBotGrants.slots })
        .from(customBotGrants)
        .where(eq(customBotGrants.userId, ownerUserId));
      const [owned] = await transaction
        .select({ value: count() })
        .from(customBots)
        .where(
          and(eq(customBots.ownerUserId, ownerUserId), ne(customBots.desiredState, "deleted")),
        );

      if ((owned?.value ?? 0) >= (grant?.slots ?? 0)) {
        throw new CustomBotError("no-slot", "You have no free Custom bot slot.");
      }

      const [existing] = await transaction
        .select({ id: customBots.id })
        .from(customBots)
        .where(eq(customBots.applicationId, inspection.applicationId));

      if (existing !== undefined) {
        throw new CustomBotError(
          "already-registered",
          "This Discord application already runs on LunaEcho.",
        );
      }

      const id = randomUUID();
      const now = this.clock();
      const [row] = await transaction
        .insert(customBots)
        .values({
          applicationId: inspection.applicationId,
          avatarHash: inspection.avatarHash,
          botUserId: inspection.botUserId,
          createdAt: now,
          databaseName: `lunaecho_custom_${id.replaceAll("-", "").slice(0, 16)}`,
          desiredState: "running",
          id,
          name: inspection.name,
          ownerUserId,
          sealedToken: this.vault.seal(token.trim(), id),
          status: "pending",
          updatedAt: now,
        })
        .returning();

      if (row === undefined) {
        throw new Error("Custom bot insert returned no row");
      }

      return toBot(row);
    });
  }

  /** Swaps in a new token for the same application, for example after a reset on Discord. */
  public async replaceToken(
    ownerUserId: string,
    botId: string,
    token: string,
    inspection: BotTokenInspection,
  ): Promise<void> {
    const bot = await this.getOwned(ownerUserId, botId);

    if (bot.applicationId !== inspection.applicationId) {
      throw new CustomBotError(
        "different-application",
        "This token belongs to a different application.",
      );
    }

    await this.database
      .update(customBots)
      .set({
        avatarHash: inspection.avatarHash,
        name: inspection.name,
        sealedToken: this.vault.seal(token.trim(), botId),
        status: "pending",
        statusMessage: null,
        updatedAt: this.clock(),
      })
      .where(eq(customBots.id, botId));
  }

  public async setDesiredState(
    ownerUserId: string,
    botId: string,
    desiredState: CustomBotDesiredState,
  ): Promise<void> {
    const bot = await this.getOwned(ownerUserId, botId);

    await this.database.transaction(async (transaction) => {
      await transaction.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`custom-bots:${ownerUserId}`}))`,
      );

      // Only as many bots run as there are slots; a stopped bot may wait for a free one.
      if (desiredState === "running" && bot.desiredState !== "running") {
        const [grant] = await transaction
          .select({ slots: customBotGrants.slots })
          .from(customBotGrants)
          .where(eq(customBotGrants.userId, ownerUserId));
        const [running] = await transaction
          .select({ value: count() })
          .from(customBots)
          .where(
            and(eq(customBots.ownerUserId, ownerUserId), eq(customBots.desiredState, "running")),
          );

        if ((running?.value ?? 0) >= (grant?.slots ?? 0)) {
          throw new CustomBotError("no-slot", "All your Custom bot slots are in use.");
        }
      }

      await transaction
        .update(customBots)
        .set({ desiredState, updatedAt: this.clock() })
        .where(eq(customBots.id, botId));
    });
  }

  // ─── Orchestrator ────────────────────────────────────────────────────────

  /** Every bot that is not fully removed yet, with what it takes to run it. */
  public async listDeployments(): Promise<CustomBotDeployment[]> {
    const rows = await this.database
      .select()
      .from(customBots)
      .where(ne(customBots.status, "deleted"))
      .orderBy(asc(customBots.createdAt));
    return rows.map((row) => ({
      ...toBot(row),
      databaseName: row.databaseName,
      sealedToken: row.sealedToken,
      updatedAt: row.updatedAt,
    }));
  }

  public openToken(deployment: CustomBotDeployment): string {
    return this.vault.open(deployment.sealedToken, deployment.id);
  }

  /** Removes a bot for good, once its container and database are gone. */
  public async forget(botId: string): Promise<void> {
    await this.database.delete(customBots).where(eq(customBots.id, botId));
  }

  public async reportStatus(
    botId: string,
    status: CustomBotStatus,
    statusMessage: string | null = null,
  ): Promise<void> {
    await this.database
      .update(customBots)
      .set({ status, statusMessage })
      .where(eq(customBots.id, botId));
  }
}
