import type { ModerationCase, NewModerationCase } from "./moderation-case.js";

export interface ModerationCaseRepository {
  /**
   * Stores a new pending case. With a limit, only the guild's newest `maximumStoredCases` cases
   * are kept and older ones are deleted in the same step; case numbers are never reused.
   */
  createPending(
    input: NewModerationCase,
    maximumStoredCases: number | null,
  ): Promise<ModerationCase>;
  findByCaseNumber(guildId: string, caseNumber: number): Promise<ModerationCase | undefined>;
  listRecent(guildId: string, limit: number): Promise<ModerationCase[]>;
  listForTarget(guildId: string, targetUserId: string, limit: number): Promise<ModerationCase[]>;
  markCompleted(guildId: string, caseNumber: number, completedAt: Date): Promise<void>;
  markFailed(
    guildId: string,
    caseNumber: number,
    failureCode: string,
    completedAt: Date,
  ): Promise<void>;
}
