import { toError, type AppLogger } from "@lunaecho/core";

import type { ModerationCase, NewModerationCase } from "./moderation-case.js";
import type { ModerationCaseRepository } from "./moderation-case-repository.js";

export type ModerationActionRequest = Omit<NewModerationCase, "createdAt">;

export type CompletedModerationAction<Result> = Readonly<{
  moderationCase: ModerationCase;
  result: Result;
}>;

export class ModerationActionExecutionError extends Error {
  public constructor(
    public readonly moderationCase: ModerationCase,
    cause: unknown,
  ) {
    super(`Moderation action for case #${moderationCase.caseNumber} failed`, { cause });
    this.name = "ModerationActionExecutionError";
  }
}

/** Resolves how many cases a guild may keep; null keeps every case. */
export type StoredCaseLimitResolver = (guildId: string) => Promise<number | null>;

export class ModerationActionService {
  private readonly listeners: ((moderationCase: ModerationCase) => void)[] = [];

  public constructor(
    private readonly repository: ModerationCaseRepository,
    private readonly logger: AppLogger,
    private readonly now: () => Date = () => new Date(),
    private readonly resolveStoredCaseLimit: StoredCaseLimitResolver = () => Promise.resolve(null),
  ) {}

  /** Called with every case once it completed or failed, for example to post it to a log. */
  public subscribe(listener: (moderationCase: ModerationCase) => void): void {
    this.listeners.push(listener);
  }

  public findCase(guildId: string, caseNumber: number): Promise<ModerationCase | undefined> {
    return this.repository.findByCaseNumber(guildId, caseNumber);
  }

  public listHistory(
    guildId: string,
    targetUserId: string,
    limit: number,
  ): Promise<ModerationCase[]> {
    return this.repository.listForTarget(guildId, targetUserId, limit);
  }

  public listRecent(guildId: string, limit: number): Promise<ModerationCase[]> {
    return this.repository.listRecent(guildId, limit);
  }

  public async execute<Result>(
    request: ModerationActionRequest,
    operation: (moderationCase: ModerationCase) => Promise<Result>,
  ): Promise<CompletedModerationAction<Result>> {
    const pendingCase = await this.repository.createPending(
      { ...request, createdAt: this.now() },
      await this.resolveStoredCaseLimit(request.guildId),
    );
    const logContext = {
      action: pendingCase.action,
      caseNumber: pendingCase.caseNumber,
      guildId: pendingCase.guildId,
      moderatorUserId: pendingCase.moderatorUserId,
      targetUserId: pendingCase.targetUserId,
    };

    this.logger.info(logContext, "Moderation case opened");

    let result: Result;

    try {
      result = await operation(pendingCase);
    } catch (error) {
      const completedAt = this.now();

      try {
        await this.repository.markFailed(
          pendingCase.guildId,
          pendingCase.caseNumber,
          "discord-action-failed",
          completedAt,
        );
      } catch (persistenceError) {
        this.logger.error(
          { ...logContext, err: toError(persistenceError) },
          "Failed to persist moderation case failure",
        );
      }

      const failedCase = {
        ...pendingCase,
        completedAt,
        failureCode: "discord-action-failed",
        status: "failed",
      } satisfies ModerationCase;
      this.logger.error(
        { ...logContext, err: toError(error), result: "failed" },
        "Moderation action failed",
      );
      this.emit(failedCase);
      throw new ModerationActionExecutionError(failedCase, error);
    }

    const completedAt = this.now();
    await this.repository.markCompleted(pendingCase.guildId, pendingCase.caseNumber, completedAt);
    const completedCase = {
      ...pendingCase,
      completedAt,
      status: "completed",
    } satisfies ModerationCase;

    this.logger.info({ ...logContext, result: "completed" }, "Moderation action completed");

    this.emit(completedCase);
    return { moderationCase: completedCase, result };
  }

  private emit(moderationCase: ModerationCase): void {
    for (const listener of this.listeners) {
      try {
        listener(moderationCase);
      } catch (error) {
        this.logger.error({ err: toError(error) }, "Moderation case listener failed");
      }
    }
  }
}
