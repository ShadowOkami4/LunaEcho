import { guildModerationCaseCounters, guildModerationCases, type LunaDatabase } from "@lunaecho/db";
import { and, desc, eq, lte, sql } from "drizzle-orm";

import {
  moderationActions,
  moderationCaseStatuses,
  type ModerationAction,
  type ModerationCase,
  type ModerationCaseStatus,
  type NewModerationCase,
} from "./moderation-case.js";
import type { ModerationCaseRepository } from "./moderation-case-repository.js";

type ModerationCaseRow = typeof guildModerationCases.$inferSelect;

function parseAction(value: string): ModerationAction {
  const action = moderationActions.find((candidate) => candidate === value);

  if (action === undefined) {
    throw new TypeError(`Stored moderation action '${value}' is invalid`);
  }

  return action;
}

function parseStatus(value: string): ModerationCaseStatus {
  const status = moderationCaseStatuses.find((candidate) => candidate === value);

  if (status === undefined) {
    throw new TypeError(`Stored moderation case status '${value}' is invalid`);
  }

  return status;
}

function mapCase(row: ModerationCaseRow): ModerationCase {
  return {
    action: parseAction(row.action),
    caseNumber: row.caseNumber,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    durationSeconds: row.durationSeconds,
    failureCode: row.failureCode,
    guildId: row.guildId,
    moderatorUserId: row.moderatorUserId,
    reason: row.reason,
    status: parseStatus(row.status),
    targetUserId: row.targetUserId,
  };
}

export class DrizzleModerationCaseRepository implements ModerationCaseRepository {
  public constructor(private readonly database: LunaDatabase) {}

  public createPending(
    input: NewModerationCase,
    maximumStoredCases: number | null,
  ): Promise<ModerationCase> {
    return this.database.transaction(async (transaction) => {
      await transaction
        .insert(guildModerationCaseCounters)
        .values({ guildId: input.guildId, nextCaseNumber: 1 })
        .onConflictDoNothing();

      // The row lock taken by this update serializes concurrent allocations for one guild.
      const [counter] = await transaction
        .update(guildModerationCaseCounters)
        .set({ nextCaseNumber: sql`${guildModerationCaseCounters.nextCaseNumber} + 1` })
        .where(eq(guildModerationCaseCounters.guildId, input.guildId))
        .returning({ nextCaseNumber: guildModerationCaseCounters.nextCaseNumber });

      if (counter === undefined) {
        throw new TypeError("PostgreSQL did not allocate a moderation case number");
      }

      const [row] = await transaction
        .insert(guildModerationCases)
        .values({
          action: input.action,
          caseNumber: counter.nextCaseNumber - 1,
          createdAt: input.createdAt,
          durationSeconds: input.durationSeconds ?? null,
          guildId: input.guildId,
          moderatorUserId: input.moderatorUserId,
          reason: input.reason,
          status: "pending",
          targetUserId: input.targetUserId ?? null,
        })
        .returning();

      if (row === undefined) {
        throw new TypeError("PostgreSQL did not return the created moderation case");
      }

      if (maximumStoredCases !== null) {
        // Case numbers are sequential per guild, so everything at or below this number is older
        // than the newest `maximumStoredCases` cases.
        await transaction
          .delete(guildModerationCases)
          .where(
            and(
              eq(guildModerationCases.guildId, input.guildId),
              lte(guildModerationCases.caseNumber, row.caseNumber - maximumStoredCases),
            ),
          );
      }

      return mapCase(row);
    });
  }

  public async findByCaseNumber(
    guildId: string,
    caseNumber: number,
  ): Promise<ModerationCase | undefined> {
    const [row] = await this.database
      .select()
      .from(guildModerationCases)
      .where(
        and(
          eq(guildModerationCases.guildId, guildId),
          eq(guildModerationCases.caseNumber, caseNumber),
        ),
      );

    return row === undefined ? undefined : mapCase(row);
  }

  public async listForTarget(
    guildId: string,
    targetUserId: string,
    limit: number,
  ): Promise<ModerationCase[]> {
    const rows = await this.database
      .select()
      .from(guildModerationCases)
      .where(
        and(
          eq(guildModerationCases.guildId, guildId),
          eq(guildModerationCases.targetUserId, targetUserId),
        ),
      )
      .orderBy(desc(guildModerationCases.caseNumber))
      .limit(limit);

    return rows.map(mapCase);
  }

  public async listRecent(guildId: string, limit: number): Promise<ModerationCase[]> {
    const rows = await this.database
      .select()
      .from(guildModerationCases)
      .where(eq(guildModerationCases.guildId, guildId))
      .orderBy(desc(guildModerationCases.caseNumber))
      .limit(limit);

    return rows.map(mapCase);
  }

  public markCompleted(guildId: string, caseNumber: number, completedAt: Date): Promise<void> {
    return this.updateStatus(guildId, caseNumber, "completed", null, completedAt);
  }

  public markFailed(
    guildId: string,
    caseNumber: number,
    failureCode: string,
    completedAt: Date,
  ): Promise<void> {
    return this.updateStatus(guildId, caseNumber, "failed", failureCode, completedAt);
  }

  private async updateStatus(
    guildId: string,
    caseNumber: number,
    status: "completed" | "failed",
    failureCode: string | null,
    completedAt: Date,
  ): Promise<void> {
    const updated = await this.database
      .update(guildModerationCases)
      .set({ completedAt, failureCode, status })
      .where(
        and(
          eq(guildModerationCases.guildId, guildId),
          eq(guildModerationCases.caseNumber, caseNumber),
          eq(guildModerationCases.status, "pending"),
        ),
      )
      .returning({ caseNumber: guildModerationCases.caseNumber });

    if (updated.length === 0) {
      throw new Error(`Pending moderation case #${caseNumber} was not found`);
    }
  }
}
