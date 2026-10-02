import type { Clock } from "@lunaecho/core";
import { reminders, type LunaDatabase } from "@lunaecho/db";
import { and, asc, count, eq, inArray, lte, sql } from "drizzle-orm";

export const maximumRemindersPerMember = 25;
export const maximumReminderTextLength = 500;
export const minimumReminderDelayMilliseconds = 60_000;
export const maximumReminderDelayMilliseconds = 365 * 86_400_000;

export type Reminder = Readonly<{
  channelId: string;
  createdAt: Date;
  dueAt: Date;
  guildId: string;
  id: number;
  text: string;
  userId: string;
}>;

export type CreateReminderResult =
  | Readonly<{ kind: "created"; reminder: Reminder }>
  | Readonly<{ kind: "invalid-delay" | "invalid-text" | "too-many" }>;

export class ReminderService {
  public constructor(
    private readonly database: LunaDatabase,
    private readonly clock: Clock = () => new Date(),
  ) {}

  public async create(
    input: Readonly<{
      channelId: string;
      delayMilliseconds: number;
      guildId: string;
      text: string;
      userId: string;
    }>,
  ): Promise<CreateReminderResult> {
    const text = input.text.trim();

    if (text.length === 0 || text.length > maximumReminderTextLength) {
      return { kind: "invalid-text" };
    }

    if (
      input.delayMilliseconds < minimumReminderDelayMilliseconds ||
      input.delayMilliseconds > maximumReminderDelayMilliseconds
    ) {
      return { kind: "invalid-delay" };
    }

    return this.database.transaction(async (transaction) => {
      // Serializes creation per member so the limit holds under concurrent commands.
      await transaction.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`reminders:${input.guildId}:${input.userId}`}))`,
      );
      const [open] = await transaction
        .select({ value: count() })
        .from(reminders)
        .where(and(eq(reminders.guildId, input.guildId), eq(reminders.userId, input.userId)));

      if ((open?.value ?? 0) >= maximumRemindersPerMember) {
        return { kind: "too-many" } as const;
      }

      const now = this.clock();
      const [row] = await transaction
        .insert(reminders)
        .values({
          channelId: input.channelId,
          createdAt: now,
          dueAt: new Date(now.getTime() + input.delayMilliseconds),
          guildId: input.guildId,
          text,
          userId: input.userId,
        })
        .returning();

      if (row === undefined) {
        throw new Error("PostgreSQL did not return the created reminder");
      }

      return { kind: "created", reminder: row } as const;
    });
  }

  public list(guildId: string, userId: string): Promise<Reminder[]> {
    return this.database
      .select()
      .from(reminders)
      .where(and(eq(reminders.guildId, guildId), eq(reminders.userId, userId)))
      .orderBy(asc(reminders.dueAt));
  }

  /** Deletes reminders of this member; ids of other members are ignored. */
  public async cancel(guildId: string, userId: string, ids: readonly number[]): Promise<number> {
    if (ids.length === 0) {
      return 0;
    }

    const removed = await this.database
      .delete(reminders)
      .where(
        and(
          eq(reminders.guildId, guildId),
          eq(reminders.userId, userId),
          inArray(reminders.id, [...ids]),
        ),
      )
      .returning({ id: reminders.id });
    return removed.length;
  }

  /**
   * Removes and returns due reminders. Deleting before delivery means a crash loses at most this
   * batch instead of sending reminders twice.
   */
  public takeDue(limit: number, now: Date = this.clock()): Promise<Reminder[]> {
    return this.database
      .delete(reminders)
      .where(
        sql`${reminders.id} IN (
          SELECT ${reminders.id} FROM ${reminders}
          WHERE ${lte(reminders.dueAt, now)}
          ORDER BY ${reminders.dueAt}
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        )`,
      )
      .returning();
  }
}
