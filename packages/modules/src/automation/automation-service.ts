import { randomUUID } from "node:crypto";

import { ExpiringCache, type Clock } from "@lunaecho/core";
import { automationRules, type LunaDatabase } from "@lunaecho/db";
import { and, asc, count, eq, inArray, lte, sql } from "drizzle-orm";

export const maximumAutomationRulesPerGuild = 25;
export const maximumAutomationActions = 5;
export const maximumAutomationKeywords = 20;
export const minimumScheduleMinutes = 60;
export const maximumScheduleMinutes = 7 * 24 * 60;

export type AutomationTrigger =
  | Readonly<{ kind: "member-join" }>
  | Readonly<{ keywords: readonly string[]; kind: "message-keyword"; match: "contains" | "exact" }>
  | Readonly<{ intervalMinutes: number; kind: "schedule" }>;

export type AutomationConditions = Readonly<{
  /** For message rules: only these channels. Empty means everywhere. */
  channelIds: readonly string[];
  /** The member must have all of these roles. */
  requiredRoleIds: readonly string[];
  /** The member must have none of these roles. */
  excludedRoleIds: readonly string[];
}>;

/** "channelId: null" in a message action means the channel the trigger happened in. */
export type AutomationAction =
  | Readonly<{ channelId: string | null; kind: "send-message"; text: string }>
  | Readonly<{ kind: "send-dm"; text: string }>
  | Readonly<{ kind: "add-role" | "remove-role"; roleId: string }>
  | Readonly<{ emoji: string; kind: "react" }>;

export type AutomationRule = Readonly<{
  actions: readonly AutomationAction[];
  conditions: AutomationConditions;
  cooldownSeconds: number;
  enabled: boolean;
  guildId: string;
  id: string;
  name: string;
  trigger: AutomationTrigger;
}>;

export type AutomationRuleInput = Omit<AutomationRule, "id"> & Readonly<{ id?: string }>;

export class AutomationInputError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "AutomationInputError";
  }
}

/** Which actions make sense for which trigger. */
export function actionAllowed(trigger: AutomationTrigger, action: AutomationAction): boolean {
  if (trigger.kind === "schedule") {
    return action.kind === "send-message" && action.channelId !== null;
  }

  if (trigger.kind === "member-join") {
    return (
      action.kind !== "react" && !(action.kind === "send-message" && action.channelId === null)
    );
  }

  return true;
}

export function matchesKeyword(
  trigger: Extract<AutomationTrigger, { kind: "message-keyword" }>,
  content: string,
): boolean {
  const text = content.trim().toLowerCase();
  return trigger.keywords.some((keyword) =>
    trigger.match === "exact" ? text === keyword : text.includes(keyword),
  );
}

export function conditionsMet(
  conditions: AutomationConditions,
  context: Readonly<{ channelId: string | null; roleIds: ReadonlySet<string> }>,
): boolean {
  return (
    (conditions.channelIds.length === 0 ||
      (context.channelId !== null && conditions.channelIds.includes(context.channelId))) &&
    conditions.requiredRoleIds.every((roleId) => context.roleIds.has(roleId)) &&
    !conditions.excludedRoleIds.some((roleId) => context.roleIds.has(roleId))
  );
}

/** Placeholders: {user}, {username}, {server}, {channel}. */
export function renderAutomationText(
  text: string,
  values: Readonly<{
    channelId: string | null;
    serverName: string;
    userId: string | null;
    username: string | null;
  }>,
): string {
  return text
    .replaceAll("{user}", values.userId === null ? "" : `<@${values.userId}>`)
    .replaceAll("{username}", values.username ?? "")
    .replaceAll("{server}", values.serverName)
    .replaceAll("{channel}", values.channelId === null ? "" : `<#${values.channelId}>`);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].slice(0, 25);
}

function validateTrigger(trigger: AutomationTrigger): AutomationTrigger {
  switch (trigger.kind) {
    case "member-join":
      return trigger;
    case "message-keyword": {
      const keywords = unique(
        trigger.keywords
          .map((keyword) => keyword.trim().toLowerCase())
          .filter((keyword) => keyword.length > 0),
      );

      if (keywords.length === 0 || keywords.length > maximumAutomationKeywords) {
        throw new AutomationInputError(`Give 1 to ${maximumAutomationKeywords} keywords.`);
      }

      if (keywords.some((keyword) => keyword.length > 100)) {
        throw new AutomationInputError("Keywords can have at most 100 characters.");
      }

      return {
        keywords,
        kind: trigger.kind,
        match: trigger.match === "exact" ? "exact" : "contains",
      };
    }
    case "schedule":
      if (
        !Number.isInteger(trigger.intervalMinutes) ||
        trigger.intervalMinutes < minimumScheduleMinutes ||
        trigger.intervalMinutes > maximumScheduleMinutes
      ) {
        throw new AutomationInputError("Scheduled rules run every 1 hour up to every 7 days.");
      }

      return trigger;
  }
}

function validateAction(action: AutomationAction): AutomationAction {
  switch (action.kind) {
    case "send-message":
    case "send-dm": {
      const text = action.text.trim();

      if (text.length === 0 || text.length > 1_500) {
        throw new AutomationInputError("Messages need 1 to 1,500 characters.");
      }

      return { ...action, text };
    }
    case "react":
      if (action.emoji.trim().length === 0) {
        throw new AutomationInputError("Choose an emoji to react with.");
      }

      return { emoji: action.emoji.trim(), kind: "react" };
    case "add-role":
    case "remove-role":
      return action;
  }
}

export function validateAutomationRule(input: AutomationRuleInput): AutomationRuleInput {
  const name = input.name.trim();

  if (name.length === 0 || name.length > 80) {
    throw new AutomationInputError("The name needs 1 to 80 characters.");
  }

  if (input.actions.length === 0 || input.actions.length > maximumAutomationActions) {
    throw new AutomationInputError(`A rule needs 1 to ${maximumAutomationActions} actions.`);
  }

  if (
    !Number.isInteger(input.cooldownSeconds) ||
    input.cooldownSeconds < 0 ||
    input.cooldownSeconds > 86_400
  ) {
    throw new AutomationInputError("The cooldown must be between 0 seconds and 1 day.");
  }

  const trigger = validateTrigger(input.trigger);
  const actions = input.actions.map(validateAction);

  if (!actions.every((action) => actionAllowed(trigger, action))) {
    throw new AutomationInputError("One of the actions does not work with this trigger.");
  }

  return {
    ...input,
    actions,
    conditions: {
      channelIds: unique(input.conditions.channelIds),
      excludedRoleIds: unique(input.conditions.excludedRoleIds),
      requiredRoleIds: unique(input.conditions.requiredRoleIds),
    },
    name,
    trigger,
  };
}

function toRule(row: typeof automationRules.$inferSelect): AutomationRule {
  return {
    actions: row.actions as AutomationAction[],
    conditions: row.conditions as AutomationConditions,
    cooldownSeconds: row.cooldownSeconds,
    enabled: row.enabled,
    guildId: row.guildId,
    id: row.id,
    name: row.name,
    trigger: row.trigger as AutomationTrigger,
  };
}

export class AutomationService {
  private readonly cache: ExpiringCache<string, readonly AutomationRule[]>;

  public constructor(
    private readonly database: LunaDatabase,
    private readonly clock: Clock = () => new Date(),
  ) {
    this.cache = new ExpiringCache({ clock, maximumEntries: 10_000, ttlMilliseconds: 60_000 });
  }

  public invalidate(guildId: string): void {
    this.cache.delete(guildId);
  }

  public async list(guildId: string): Promise<readonly AutomationRule[]> {
    const cached = this.cache.get(guildId);

    if (cached !== undefined) {
      return cached;
    }

    const rows = await this.database
      .select()
      .from(automationRules)
      .where(eq(automationRules.guildId, guildId))
      .orderBy(asc(automationRules.name), asc(automationRules.id));
    const rules = rows.map(toRule);
    this.cache.set(guildId, rules);
    return rules;
  }

  /** The enabled rules of a guild that react to one trigger. */
  public async rulesFor<Kind extends AutomationTrigger["kind"]>(
    guildId: string,
    kind: Kind,
  ): Promise<(AutomationRule & { trigger: Extract<AutomationTrigger, { kind: Kind }> })[]> {
    return (await this.list(guildId)).filter(
      (rule): rule is AutomationRule & { trigger: Extract<AutomationTrigger, { kind: Kind }> } =>
        rule.enabled && rule.trigger.kind === kind,
    );
  }

  public async save(input: AutomationRuleInput, actorId: string): Promise<AutomationRule> {
    const rule = validateAutomationRule(input);
    const now = this.clock();
    const values = {
      actions: rule.actions,
      conditions: rule.conditions,
      cooldownSeconds: rule.cooldownSeconds,
      enabled: rule.enabled,
      name: rule.name,
      // Saving restarts the schedule, so a changed interval applies right away.
      nextRunAt:
        rule.trigger.kind === "schedule" && rule.enabled
          ? new Date(now.getTime() + rule.trigger.intervalMinutes * 60_000)
          : null,
      trigger: rule.trigger,
      updatedAt: now,
      updatedBy: actorId,
    };

    try {
      if (rule.id !== undefined) {
        const updated = await this.database
          .update(automationRules)
          .set(values)
          .where(and(eq(automationRules.guildId, rule.guildId), eq(automationRules.id, rule.id)))
          .returning({ id: automationRules.id });

        if (updated.length === 0) {
          throw new AutomationInputError("This rule does not exist anymore.");
        }

        return { ...rule, id: rule.id };
      }

      const [existing] = await this.database
        .select({ value: count() })
        .from(automationRules)
        .where(eq(automationRules.guildId, rule.guildId));

      if ((existing?.value ?? 0) >= maximumAutomationRulesPerGuild) {
        throw new AutomationInputError(
          `A server can have at most ${maximumAutomationRulesPerGuild} rules.`,
        );
      }

      const id = randomUUID();
      await this.database.insert(automationRules).values({ ...values, guildId: rule.guildId, id });
      return { ...rule, id };
    } finally {
      this.cache.delete(rule.guildId);
    }
  }

  public async delete(guildId: string, ruleId: string): Promise<void> {
    await this.database
      .delete(automationRules)
      .where(and(eq(automationRules.guildId, guildId), eq(automationRules.id, ruleId)));
    this.cache.delete(guildId);
  }

  /**
   * Claims scheduled rules that are due and moves their next run forward in the same statement,
   * so two bot processes never run the same rule twice.
   */
  public async takeDueScheduled(limit = 100): Promise<AutomationRule[]> {
    const now = this.clock();
    const due = this.database
      .select({ id: automationRules.id })
      .from(automationRules)
      .where(and(eq(automationRules.enabled, true), lte(automationRules.nextRunAt, now)))
      .limit(limit)
      .for("update", { skipLocked: true });
    const rows = await this.database
      .update(automationRules)
      .set({
        nextRunAt: sql`${now.toISOString()}::timestamptz + make_interval(mins => (${automationRules.trigger}->>'intervalMinutes')::int)`,
      })
      .where(inArray(automationRules.id, due))
      .returning();
    return rows.map(toRule);
  }
}
