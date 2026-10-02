import { botTasks, type LunaDatabase } from "@lunaecho/db";
import { and, eq, isNull, lt, sql } from "drizzle-orm";

/** Every kind of work the dashboard can hand to the bot. */
export interface BotTaskPayloads {
  /** A module's settings changed; the bot drops its cached copy at once. */
  "settings-changed": Readonly<{ module: string }>;
  /** Post or refresh the verification button in its channel. */
  "post-verification-panel": Readonly<Record<string, never>>;
  /** Post or refresh the button members use to open a ticket. */
  "post-ticket-panel": Readonly<Record<string, never>>;
  /** Post or refresh one self-service role menu. */
  "post-role-menu": Readonly<{ menuId: string }>;
  /** The menu itself is already deleted, so its posted message is passed along. */
  "remove-role-menu": Readonly<{ channelId: string; messageId: string }>;
}

export type BotTaskKind = keyof BotTaskPayloads;

export type BotTask = Readonly<{
  attempts: number;
  guildId: string;
  id: number;
  kind: string;
  payload: Readonly<Record<string, unknown>>;
}>;

/** A claimed task that is not completed within this time is offered again. */
const claimTimeoutMilliseconds = 60_000;
const maximumAttempts = 5;

export class BotTaskQueue {
  public constructor(private readonly database: LunaDatabase) {}

  public async enqueue<Kind extends BotTaskKind>(
    kind: Kind,
    guildId: string,
    payload: BotTaskPayloads[Kind],
  ): Promise<void> {
    await this.database.insert(botTasks).values({ guildId, kind, payload: { ...payload } });
  }

  /** Atomically takes up to `limit` open tasks, oldest first. */
  public async claim(limit: number, now: Date = new Date()): Promise<BotTask[]> {
    const staleBefore = new Date(now.getTime() - claimTimeoutMilliseconds);
    const rows = await this.database
      .update(botTasks)
      .set({ attempts: sql`${botTasks.attempts} + 1`, claimedAt: now })
      .where(
        sql`${botTasks.id} IN (
          SELECT ${botTasks.id} FROM ${botTasks}
          WHERE ${botTasks.completedAt} IS NULL
            AND ${botTasks.attempts} < ${maximumAttempts}
            AND (${botTasks.claimedAt} IS NULL OR ${botTasks.claimedAt} < ${staleBefore})
          ORDER BY ${botTasks.id}
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        )`,
      )
      .returning({
        attempts: botTasks.attempts,
        guildId: botTasks.guildId,
        id: botTasks.id,
        kind: botTasks.kind,
        payload: botTasks.payload,
      });

    return rows.sort((left, right) => left.id - right.id);
  }

  public async complete(id: number, now: Date = new Date()): Promise<void> {
    await this.database.update(botTasks).set({ completedAt: now }).where(eq(botTasks.id, id));
  }

  /** Records the failure; the task is retried after the claim timeout until attempts run out. */
  public async fail(id: number, error: string): Promise<void> {
    await this.database
      .update(botTasks)
      .set({ lastError: error.slice(0, 1_000) })
      .where(eq(botTasks.id, id));
  }

  /** Deletes completed tasks older than the given age, so the table stays small. */
  public async prune(olderThan: Date): Promise<void> {
    await this.database.delete(botTasks).where(and(lt(botTasks.completedAt, olderThan)));
  }

  public async pending(): Promise<number> {
    const rows = await this.database
      .select({ id: botTasks.id })
      .from(botTasks)
      .where(isNull(botTasks.completedAt));
    return rows.length;
  }
}
