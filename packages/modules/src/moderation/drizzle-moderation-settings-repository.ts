import {
  guildAutomodExemptions,
  guildAutomodRules,
  guildBannedWords,
  guildModerationSettings,
  type LunaDatabase,
} from "@lunaecho/db";
import { and, asc, count, eq, sql } from "drizzle-orm";

import {
  createDefaultAutomodRules,
  isAutomodProfile,
  isAutomodRuleAction,
  isAutomodRuleKind,
  type AutomodRuleAction,
  type AutomodRuleKind,
  type AutomodRuleSettings,
  type AutomodRuleThreshold,
  type ConfigurableAutomodProfile,
} from "./automod-rule.js";
import type {
  AddBannedWordResult,
  BannedWord,
  ExemptionMutationResult,
  GuildModerationSettings,
  NewBannedWord,
} from "./moderation-settings.js";
import type { ModerationSettingsRepository } from "./moderation-settings-repository.js";

type AutomodRuleRow = Pick<
  typeof guildAutomodRules.$inferSelect,
  | "action"
  | "enabled"
  | "ruleKind"
  | "secondaryLimit"
  | "timeoutSeconds"
  | "triggerLimit"
  | "windowSeconds"
>;
type ExemptionKind = "channel" | "role";
type GuildFlag = "bannedWordsEnabled" | "dmNotificationsEnabled" | "staffExempt";

const automodRuleColumns = {
  action: guildAutomodRules.action,
  enabled: guildAutomodRules.enabled,
  ruleKind: guildAutomodRules.ruleKind,
  secondaryLimit: guildAutomodRules.secondaryLimit,
  timeoutSeconds: guildAutomodRules.timeoutSeconds,
  triggerLimit: guildAutomodRules.triggerLimit,
  windowSeconds: guildAutomodRules.windowSeconds,
};

const automodRuleKey = [guildAutomodRules.guildId, guildAutomodRules.ruleKind];

function mapAutomodRule(row: AutomodRuleRow): AutomodRuleSettings {
  if (!isAutomodRuleKind(row.ruleKind)) {
    throw new TypeError(`Stored automod rule kind '${row.ruleKind}' is invalid`);
  }

  if (!isAutomodRuleAction(row.action)) {
    throw new TypeError(`Stored automod rule action '${row.action}' is invalid`);
  }

  return {
    action: row.action,
    enabled: row.enabled,
    kind: row.ruleKind,
    threshold: {
      secondaryLimit: row.secondaryLimit,
      triggerLimit: row.triggerLimit,
      windowSeconds: row.windowSeconds,
    },
    timeoutSeconds: row.timeoutSeconds,
  };
}

function requireDefaultRule(kind: AutomodRuleKind): AutomodRuleSettings {
  const rule = createDefaultAutomodRules().find((candidate) => candidate.kind === kind);

  if (rule === undefined) {
    throw new TypeError(`Unknown AutoMod rule '${kind}'`);
  }

  return rule;
}

/**
 * Creates the guild's settings row if needed and locks it for the rest of the transaction, so
 * concurrent changes to one guild's limits and profile cannot interleave.
 */
async function lockGuildSettings(
  transaction: LunaDatabase,
  guildId: string,
  timestamp: Date,
): Promise<void> {
  await transaction
    .insert(guildModerationSettings)
    .values({ createdAt: timestamp, guildId, updatedAt: timestamp })
    .onConflictDoNothing();
  await transaction
    .select({ guildId: guildModerationSettings.guildId })
    .from(guildModerationSettings)
    .where(eq(guildModerationSettings.guildId, guildId))
    .for("update");
}

async function touchGuildSettings(
  transaction: LunaDatabase,
  guildId: string,
  timestamp: Date,
): Promise<void> {
  await transaction
    .update(guildModerationSettings)
    .set({ updatedAt: timestamp })
    .where(eq(guildModerationSettings.guildId, guildId));
}

async function markProfileCustom(
  transaction: LunaDatabase,
  guildId: string,
  timestamp: Date,
): Promise<void> {
  await transaction
    .update(guildModerationSettings)
    .set({ automodProfile: "custom", updatedAt: timestamp })
    .where(eq(guildModerationSettings.guildId, guildId));
}

export class DrizzleModerationSettingsRepository implements ModerationSettingsRepository {
  public constructor(private readonly database: LunaDatabase) {}

  public addBannedWord(word: NewBannedWord, maximumWords: number): Promise<AddBannedWordResult> {
    return this.database.transaction(async (transaction) => {
      await lockGuildSettings(transaction, word.guildId, word.createdAt);

      const [existing] = await transaction
        .select({ normalizedWord: guildBannedWords.normalizedWord })
        .from(guildBannedWords)
        .where(
          and(
            eq(guildBannedWords.guildId, word.guildId),
            eq(guildBannedWords.normalizedWord, word.normalizedValue),
          ),
        );

      if (existing !== undefined) {
        return "already-exists";
      }

      const [wordCount] = await transaction
        .select({ value: count() })
        .from(guildBannedWords)
        .where(eq(guildBannedWords.guildId, word.guildId));

      if (wordCount === undefined) {
        throw new TypeError("PostgreSQL did not return the banned-word count");
      }

      if (wordCount.value >= maximumWords) {
        return "limit-reached";
      }

      await transaction.insert(guildBannedWords).values({
        createdAt: word.createdAt,
        createdBy: word.createdBy,
        displayWord: word.displayValue,
        guildId: word.guildId,
        normalizedWord: word.normalizedValue,
      });
      await touchGuildSettings(transaction, word.guildId, word.createdAt);
      return "added";
    });
  }

  public applyAutomodProfile(
    guildId: string,
    profile: ConfigurableAutomodProfile,
    rules: readonly AutomodRuleSettings[],
    actorId: string,
    updatedAt: Date,
  ): Promise<void> {
    return this.database.transaction(async (transaction) => {
      await lockGuildSettings(transaction, guildId, updatedAt);

      for (const rule of rules) {
        const values = {
          action: rule.action,
          enabled: rule.enabled,
          secondaryLimit: rule.threshold.secondaryLimit,
          timeoutSeconds: rule.timeoutSeconds,
          triggerLimit: rule.threshold.triggerLimit,
          updatedAt,
          updatedBy: actorId,
          windowSeconds: rule.threshold.windowSeconds,
        };

        await transaction
          .insert(guildAutomodRules)
          .values({ ...values, createdAt: updatedAt, guildId, ruleKind: rule.kind })
          .onConflictDoUpdate({ set: values, target: automodRuleKey });
      }

      await transaction
        .update(guildModerationSettings)
        .set({ automodProfile: profile, updatedAt })
        .where(eq(guildModerationSettings.guildId, guildId));
    });
  }

  public async getByGuildId(guildId: string): Promise<GuildModerationSettings> {
    const [settingsRows, wordRows, ruleRows, exemptionRows] = await Promise.all([
      this.database
        .select()
        .from(guildModerationSettings)
        .where(eq(guildModerationSettings.guildId, guildId)),
      this.database
        .select()
        .from(guildBannedWords)
        .where(eq(guildBannedWords.guildId, guildId))
        .orderBy(sql`lower(${guildBannedWords.displayWord})`),
      this.database
        .select(automodRuleColumns)
        .from(guildAutomodRules)
        .where(eq(guildAutomodRules.guildId, guildId)),
      this.database
        .select({
          targetId: guildAutomodExemptions.targetId,
          targetKind: guildAutomodExemptions.targetKind,
        })
        .from(guildAutomodExemptions)
        .where(eq(guildAutomodExemptions.guildId, guildId))
        .orderBy(asc(guildAutomodExemptions.createdAt), asc(guildAutomodExemptions.targetId)),
    ]);
    const settings = settingsRows[0];
    const profile = settings?.automodProfile ?? "off";

    if (!isAutomodProfile(profile)) {
      throw new TypeError(`Stored AutoMod profile '${profile}' is invalid`);
    }

    const configuredRules = new Map(
      ruleRows.map((row) => {
        const rule = mapAutomodRule(row);
        return [rule.kind, rule] as const;
      }),
    );
    const exemptionIds = (kind: ExemptionKind): string[] =>
      exemptionRows.filter((row) => row.targetKind === kind).map((row) => row.targetId);

    return {
      automodProfile: profile,
      automodRules: createDefaultAutomodRules().map(
        (defaultRule) => configuredRules.get(defaultRule.kind) ?? defaultRule,
      ),
      bannedWords: wordRows.map((row): BannedWord => ({
        createdAt: row.createdAt,
        createdBy: row.createdBy,
        displayValue: row.displayWord,
        normalizedValue: row.normalizedWord,
      })),
      bannedWordsEnabled: settings?.bannedWordsEnabled ?? false,
      dmNotificationsEnabled: settings?.dmNotificationsEnabled ?? true,
      exemptChannelIds: exemptionIds("channel"),
      exemptRoleIds: exemptionIds("role"),
      guildId,
      staffExempt: settings?.staffExempt ?? true,
    };
  }

  public removeBannedWord(
    guildId: string,
    normalizedValue: string,
    updatedAt: Date,
  ): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      const removed = await transaction
        .delete(guildBannedWords)
        .where(
          and(
            eq(guildBannedWords.guildId, guildId),
            eq(guildBannedWords.normalizedWord, normalizedValue),
          ),
        )
        .returning({ normalizedWord: guildBannedWords.normalizedWord });

      if (removed.length === 0) {
        return false;
      }

      await touchGuildSettings(transaction, guildId, updatedAt);
      return true;
    });
  }

  public setAutomodRuleAction(
    guildId: string,
    ruleKind: AutomodRuleKind,
    action: AutomodRuleAction,
    actorId: string,
    updatedAt: Date,
  ): Promise<AutomodRuleSettings> {
    return this.upsertRuleAndMarkCustom(guildId, ruleKind, actorId, updatedAt, { action });
  }

  public setAutomodRuleThreshold(
    guildId: string,
    ruleKind: AutomodRuleKind,
    threshold: AutomodRuleThreshold,
    actorId: string,
    updatedAt: Date,
  ): Promise<AutomodRuleSettings> {
    return this.upsertRuleAndMarkCustom(guildId, ruleKind, actorId, updatedAt, {
      secondaryLimit: threshold.secondaryLimit,
      triggerLimit: threshold.triggerLimit,
      windowSeconds: threshold.windowSeconds,
    });
  }

  public setAutomodRuleTimeout(
    guildId: string,
    ruleKind: AutomodRuleKind,
    timeoutSeconds: number,
    actorId: string,
    updatedAt: Date,
  ): Promise<AutomodRuleSettings> {
    return this.upsertRuleAndMarkCustom(guildId, ruleKind, actorId, updatedAt, {
      timeoutSeconds,
    });
  }

  public toggleBannedWords(guildId: string, updatedAt: Date): Promise<boolean> {
    return this.toggleGuildFlag(guildId, "bannedWordsEnabled", updatedAt);
  }

  public toggleDmNotifications(guildId: string, updatedAt: Date): Promise<boolean> {
    return this.toggleGuildFlag(guildId, "dmNotificationsEnabled", updatedAt);
  }

  public toggleExemptChannel(
    guildId: string,
    channelId: string,
    actorId: string,
    maximumExemptions: number,
    updatedAt: Date,
  ): Promise<ExemptionMutationResult> {
    return this.toggleExemption(
      "channel",
      guildId,
      channelId,
      actorId,
      maximumExemptions,
      updatedAt,
    );
  }

  public toggleExemptRole(
    guildId: string,
    roleId: string,
    actorId: string,
    maximumExemptions: number,
    updatedAt: Date,
  ): Promise<ExemptionMutationResult> {
    return this.toggleExemption("role", guildId, roleId, actorId, maximumExemptions, updatedAt);
  }

  public toggleStaffExempt(guildId: string, updatedAt: Date): Promise<boolean> {
    return this.toggleGuildFlag(guildId, "staffExempt", updatedAt);
  }

  public toggleAutomodRule(
    guildId: string,
    ruleKind: AutomodRuleKind,
    actorId: string,
    updatedAt: Date,
  ): Promise<AutomodRuleSettings> {
    const defaultRule = requireDefaultRule(ruleKind);

    return this.database.transaction(async (transaction) => {
      await lockGuildSettings(transaction, guildId, updatedAt);

      // A rule without a stored row is disabled, so its first toggle creates it enabled.
      const [row] = await transaction
        .insert(guildAutomodRules)
        .values({
          action: defaultRule.action,
          createdAt: updatedAt,
          enabled: true,
          guildId,
          ruleKind,
          secondaryLimit: defaultRule.threshold.secondaryLimit,
          timeoutSeconds: defaultRule.timeoutSeconds,
          triggerLimit: defaultRule.threshold.triggerLimit,
          updatedAt,
          updatedBy: actorId,
          windowSeconds: defaultRule.threshold.windowSeconds,
        })
        .onConflictDoUpdate({
          set: {
            enabled: sql`NOT ${guildAutomodRules.enabled}`,
            updatedAt,
            updatedBy: actorId,
          },
          target: automodRuleKey,
        })
        .returning(automodRuleColumns);

      if (row === undefined) {
        throw new TypeError("PostgreSQL did not return the toggled AutoMod rule");
      }

      await markProfileCustom(transaction, guildId, updatedAt);
      return mapAutomodRule(row);
    });
  }

  private toggleExemption(
    kind: ExemptionKind,
    guildId: string,
    targetId: string,
    actorId: string,
    maximumExemptions: number,
    updatedAt: Date,
  ): Promise<ExemptionMutationResult> {
    return this.database.transaction(async (transaction) => {
      await lockGuildSettings(transaction, guildId, updatedAt);

      const ofKind = and(
        eq(guildAutomodExemptions.guildId, guildId),
        eq(guildAutomodExemptions.targetKind, kind),
      );
      const removed = await transaction
        .delete(guildAutomodExemptions)
        .where(and(ofKind, eq(guildAutomodExemptions.targetId, targetId)))
        .returning({ targetId: guildAutomodExemptions.targetId });

      if (removed.length > 0) {
        await touchGuildSettings(transaction, guildId, updatedAt);
        return "removed";
      }

      const [exemptionCount] = await transaction
        .select({ value: count() })
        .from(guildAutomodExemptions)
        .where(ofKind);

      if (exemptionCount === undefined || exemptionCount.value >= maximumExemptions) {
        return "limit-reached";
      }

      await transaction.insert(guildAutomodExemptions).values({
        createdAt: updatedAt,
        createdBy: actorId,
        guildId,
        targetId,
        targetKind: kind,
      });
      await touchGuildSettings(transaction, guildId, updatedAt);
      return "added";
    });
  }

  private toggleGuildFlag(guildId: string, flag: GuildFlag, updatedAt: Date): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      await lockGuildSettings(transaction, guildId, updatedAt);

      const [current] = await transaction
        .select({ value: guildModerationSettings[flag] })
        .from(guildModerationSettings)
        .where(eq(guildModerationSettings.guildId, guildId));

      if (current === undefined) {
        throw new TypeError(`PostgreSQL did not return the current '${flag}' state`);
      }

      const enabled = !current.value;
      const update = {
        bannedWordsEnabled: { bannedWordsEnabled: enabled },
        dmNotificationsEnabled: { dmNotificationsEnabled: enabled },
        staffExempt: { staffExempt: enabled },
      } as const;

      await transaction
        .update(guildModerationSettings)
        .set({ ...update[flag], updatedAt })
        .where(eq(guildModerationSettings.guildId, guildId));
      return enabled;
    });
  }

  private upsertRuleAndMarkCustom(
    guildId: string,
    ruleKind: AutomodRuleKind,
    actorId: string,
    updatedAt: Date,
    update: Partial<
      Pick<
        typeof guildAutomodRules.$inferInsert,
        "action" | "secondaryLimit" | "timeoutSeconds" | "triggerLimit" | "windowSeconds"
      >
    >,
  ): Promise<AutomodRuleSettings> {
    const defaultRule = requireDefaultRule(ruleKind);

    return this.database.transaction(async (transaction) => {
      await lockGuildSettings(transaction, guildId, updatedAt);

      // Tuning a rule that has no stored row starts from its defaults and leaves it disabled;
      // an existing row only changes the fields named in `update`.
      const [row] = await transaction
        .insert(guildAutomodRules)
        .values({
          action: defaultRule.action,
          createdAt: updatedAt,
          enabled: false,
          guildId,
          ruleKind,
          secondaryLimit: defaultRule.threshold.secondaryLimit,
          timeoutSeconds: defaultRule.timeoutSeconds,
          triggerLimit: defaultRule.threshold.triggerLimit,
          updatedAt,
          updatedBy: actorId,
          windowSeconds: defaultRule.threshold.windowSeconds,
          ...update,
        })
        .onConflictDoUpdate({
          set: { ...update, updatedAt, updatedBy: actorId },
          target: automodRuleKey,
        })
        .returning(automodRuleColumns);

      if (row === undefined) {
        throw new TypeError("PostgreSQL did not return the updated AutoMod rule");
      }

      await markProfileCustom(transaction, guildId, updatedAt);
      return mapAutomodRule(row);
    });
  }
}
