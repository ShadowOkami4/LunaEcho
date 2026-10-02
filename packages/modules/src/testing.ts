/**
 * In-memory repositories and service factories for tests and load simulations. They behave like
 * the PostgreSQL repositories but keep everything in process memory.
 */
import type { ModuleId } from "@lunaecho/core";
import pino from "pino";

import {
  createDefaultAutomodRules,
  type AutomodProfile,
  type AutomodRuleAction,
  type AutomodRuleKind,
  type AutomodRuleSettings,
  type AutomodRuleThreshold,
  type ConfigurableAutomodProfile,
} from "./moderation/automod-rule.js";
import { ModerationActionService } from "./moderation/moderation-action-service.js";
import type { ModerationCaseRepository } from "./moderation/moderation-case-repository.js";
import type { ModerationCase, NewModerationCase } from "./moderation/moderation-case.js";
import type { ModerationSettingsRepository } from "./moderation/moderation-settings-repository.js";
import { ModerationSettingsService } from "./moderation/moderation-settings-service.js";
import type {
  AddBannedWordResult,
  BannedWord,
  ExemptionMutationResult,
  GuildModerationSettings,
  NewBannedWord,
} from "./moderation/moderation-settings.js";
import type { ModuleSettingsRepository } from "./module-settings/module-settings-repository.js";
import {
  ModuleSettingsService,
  type ModuleSettingsOptions,
} from "./module-settings/module-settings-service.js";
export class InMemoryModuleSettingsRepository implements ModuleSettingsRepository {
  public listCalls = 0;
  private readonly overridesByGuild = new Map<string, Map<ModuleId, boolean>>();

  public listOverrides(guildId: string): Promise<ReadonlyMap<ModuleId, boolean>> {
    this.listCalls += 1;
    return Promise.resolve(new Map(this.overridesByGuild.get(guildId)));
  }

  public setEnabled(guildId: string, moduleId: ModuleId, enabled: boolean): Promise<void> {
    const overrides = this.overridesByGuild.get(guildId) ?? new Map<ModuleId, boolean>();
    overrides.set(moduleId, enabled);
    this.overridesByGuild.set(guildId, overrides);
    return Promise.resolve();
  }
}

export function createTestModuleService(
  options: ModuleSettingsOptions = {},
  repository: ModuleSettingsRepository = new InMemoryModuleSettingsRepository(),
): ModuleSettingsService {
  return new ModuleSettingsService(repository, {
    clock: () => new Date("2026-01-01T00:00:00.000Z"),
    ...options,
  });
}

export class InMemoryModerationSettingsRepository implements ModerationSettingsRepository {
  private readonly automodByGuild = new Map<string, Map<AutomodRuleKind, AutomodRuleSettings>>();
  private readonly bannedWordsEnabledByGuild = new Map<string, boolean>();
  private readonly dmNotificationsByGuild = new Map<string, boolean>();
  private readonly exemptChannelsByGuild = new Map<string, Set<string>>();
  private readonly exemptRolesByGuild = new Map<string, Set<string>>();
  private readonly profileByGuild = new Map<string, AutomodProfile>();
  private readonly staffExemptByGuild = new Map<string, boolean>();
  private readonly wordsByGuild = new Map<string, Map<string, BannedWord>>();

  public addBannedWord(word: NewBannedWord, maximumWords: number): Promise<AddBannedWordResult> {
    const words = this.wordsByGuild.get(word.guildId) ?? new Map<string, BannedWord>();
    this.wordsByGuild.set(word.guildId, words);

    if (words.has(word.normalizedValue)) {
      return Promise.resolve("already-exists");
    }

    if (words.size >= maximumWords) {
      return Promise.resolve("limit-reached");
    }

    words.set(word.normalizedValue, word);
    return Promise.resolve("added");
  }

  public applyAutomodProfile(
    guildId: string,
    profile: ConfigurableAutomodProfile,
    rules: readonly AutomodRuleSettings[],
  ): Promise<void> {
    this.automodByGuild.set(guildId, new Map(rules.map((rule) => [rule.kind, rule])));
    this.profileByGuild.set(guildId, profile);
    return Promise.resolve();
  }

  public getByGuildId(guildId: string): Promise<GuildModerationSettings> {
    const words = [...(this.wordsByGuild.get(guildId)?.values() ?? [])].sort((left, right) =>
      left.displayValue.localeCompare(right.displayValue),
    );

    return Promise.resolve({
      automodProfile: this.profileByGuild.get(guildId) ?? "off",
      automodRules: createDefaultAutomodRules().map(
        (defaultRule) => this.automodByGuild.get(guildId)?.get(defaultRule.kind) ?? defaultRule,
      ),
      bannedWords: words,
      bannedWordsEnabled: this.bannedWordsEnabledByGuild.get(guildId) ?? false,
      dmNotificationsEnabled: this.dmNotificationsByGuild.get(guildId) ?? true,
      exemptChannelIds: [...(this.exemptChannelsByGuild.get(guildId) ?? [])],
      exemptRoleIds: [...(this.exemptRolesByGuild.get(guildId) ?? [])],
      guildId,
      staffExempt: this.staffExemptByGuild.get(guildId) ?? true,
    });
  }

  public removeBannedWord(guildId: string, normalizedValue: string): Promise<boolean> {
    return Promise.resolve(this.wordsByGuild.get(guildId)?.delete(normalizedValue) ?? false);
  }

  public setAutomodRuleAction(
    guildId: string,
    ruleKind: AutomodRuleKind,
    action: AutomodRuleAction,
  ): Promise<AutomodRuleSettings> {
    return Promise.resolve(this.updateRule(guildId, ruleKind, { action }));
  }

  public setAutomodRuleThreshold(
    guildId: string,
    ruleKind: AutomodRuleKind,
    threshold: AutomodRuleThreshold,
  ): Promise<AutomodRuleSettings> {
    return Promise.resolve(this.updateRule(guildId, ruleKind, { threshold }));
  }

  public setAutomodRuleTimeout(
    guildId: string,
    ruleKind: AutomodRuleKind,
    timeoutSeconds: number,
  ): Promise<AutomodRuleSettings> {
    return Promise.resolve(this.updateRule(guildId, ruleKind, { timeoutSeconds }));
  }

  public toggleBannedWords(guildId: string): Promise<boolean> {
    const enabled = !(this.bannedWordsEnabledByGuild.get(guildId) ?? false);
    this.bannedWordsEnabledByGuild.set(guildId, enabled);
    return Promise.resolve(enabled);
  }

  public toggleDmNotifications(guildId: string): Promise<boolean> {
    const enabled = !(this.dmNotificationsByGuild.get(guildId) ?? true);
    this.dmNotificationsByGuild.set(guildId, enabled);
    return Promise.resolve(enabled);
  }

  public toggleExemptChannel(
    guildId: string,
    channelId: string,
    _actorId: string,
    maximumExemptions: number,
  ): Promise<ExemptionMutationResult> {
    return Promise.resolve(
      this.toggleExemption(this.exemptChannelsByGuild, guildId, channelId, maximumExemptions),
    );
  }

  public toggleExemptRole(
    guildId: string,
    roleId: string,
    _actorId: string,
    maximumExemptions: number,
  ): Promise<ExemptionMutationResult> {
    return Promise.resolve(
      this.toggleExemption(this.exemptRolesByGuild, guildId, roleId, maximumExemptions),
    );
  }

  public toggleStaffExempt(guildId: string): Promise<boolean> {
    const enabled = !(this.staffExemptByGuild.get(guildId) ?? true);
    this.staffExemptByGuild.set(guildId, enabled);
    return Promise.resolve(enabled);
  }

  public toggleAutomodRule(
    guildId: string,
    ruleKind: AutomodRuleKind,
  ): Promise<AutomodRuleSettings> {
    const existing = this.getAutomodRule(guildId, ruleKind);
    return Promise.resolve(this.updateRule(guildId, ruleKind, { enabled: !existing.enabled }));
  }

  private getAutomodRule(guildId: string, ruleKind: AutomodRuleKind): AutomodRuleSettings {
    const configured = this.getAutomodRules(guildId).get(ruleKind);
    const defaultRule = createDefaultAutomodRules().find((rule) => rule.kind === ruleKind);

    if (defaultRule === undefined) {
      throw new TypeError(`Unknown test AutoMod rule '${ruleKind}'`);
    }

    return configured ?? defaultRule;
  }

  private getAutomodRules(guildId: string): Map<AutomodRuleKind, AutomodRuleSettings> {
    const rules =
      this.automodByGuild.get(guildId) ?? new Map<AutomodRuleKind, AutomodRuleSettings>();
    this.automodByGuild.set(guildId, rules);
    return rules;
  }

  private toggleExemption(
    map: Map<string, Set<string>>,
    guildId: string,
    id: string,
    maximumExemptions: number,
  ): ExemptionMutationResult {
    const exemptions = map.get(guildId) ?? new Set<string>();
    map.set(guildId, exemptions);

    if (exemptions.delete(id)) {
      return "removed";
    }

    if (exemptions.size >= maximumExemptions) {
      return "limit-reached";
    }

    exemptions.add(id);
    return "added";
  }

  private updateRule(
    guildId: string,
    ruleKind: AutomodRuleKind,
    update: Partial<
      Pick<AutomodRuleSettings, "action" | "enabled" | "threshold" | "timeoutSeconds">
    >,
  ): AutomodRuleSettings {
    const updated = { ...this.getAutomodRule(guildId, ruleKind), ...update };
    this.getAutomodRules(guildId).set(ruleKind, updated);
    this.profileByGuild.set(guildId, "custom");
    return updated;
  }
}

export function createTestModerationService(
  clock: () => Date = () => new Date("2026-01-01T00:00:00.000Z"),
): ModerationSettingsService {
  return new ModerationSettingsService(new InMemoryModerationSettingsRepository(), clock);
}

export class InMemoryModerationCaseRepository implements ModerationCaseRepository {
  private readonly cases = new Map<string, ModerationCase[]>();

  public createPending(input: NewModerationCase): Promise<ModerationCase> {
    const guildCases = this.cases.get(input.guildId) ?? [];
    const moderationCase: ModerationCase = {
      action: input.action,
      caseNumber: guildCases.length + 1,
      completedAt: null,
      createdAt: input.createdAt,
      durationSeconds: input.durationSeconds ?? null,
      failureCode: null,
      guildId: input.guildId,
      moderatorUserId: input.moderatorUserId,
      reason: input.reason,
      status: "pending",
      targetUserId: input.targetUserId ?? null,
    };
    guildCases.push(moderationCase);
    this.cases.set(input.guildId, guildCases);
    return Promise.resolve(moderationCase);
  }

  public findByCaseNumber(
    guildId: string,
    caseNumber: number,
  ): Promise<ModerationCase | undefined> {
    return Promise.resolve(
      this.cases.get(guildId)?.find((moderationCase) => moderationCase.caseNumber === caseNumber),
    );
  }

  public listForTarget(
    guildId: string,
    targetUserId: string,
    limit: number,
  ): Promise<ModerationCase[]> {
    return Promise.resolve(
      (this.cases.get(guildId) ?? [])
        .filter((moderationCase) => moderationCase.targetUserId === targetUserId)
        .toReversed()
        .slice(0, limit),
    );
  }

  public listRecent(guildId: string, limit: number): Promise<ModerationCase[]> {
    return Promise.resolve((this.cases.get(guildId) ?? []).toReversed().slice(0, limit));
  }

  public markCompleted(guildId: string, caseNumber: number, completedAt: Date): Promise<void> {
    this.replaceCase(guildId, caseNumber, {
      completedAt,
      failureCode: null,
      status: "completed",
    });
    return Promise.resolve();
  }

  public markFailed(
    guildId: string,
    caseNumber: number,
    failureCode: string,
    completedAt: Date,
  ): Promise<void> {
    this.replaceCase(guildId, caseNumber, {
      completedAt,
      failureCode,
      status: "failed",
    });
    return Promise.resolve();
  }

  private replaceCase(
    guildId: string,
    caseNumber: number,
    update: Pick<ModerationCase, "completedAt" | "failureCode" | "status">,
  ): void {
    const guildCases = this.cases.get(guildId) ?? [];
    const index = guildCases.findIndex(
      (moderationCase) => moderationCase.caseNumber === caseNumber,
    );
    const existing = guildCases[index];

    if (existing === undefined) {
      throw new Error(`Test moderation case #${caseNumber} was not found`);
    }

    guildCases[index] = { ...existing, ...update };
  }
}

export function createTestModerationActionService(
  clock: () => Date = () => new Date("2026-01-01T00:00:00.000Z"),
): ModerationActionService {
  return new ModerationActionService(
    new InMemoryModerationCaseRepository(),
    pino({ level: "silent" }),
    clock,
  );
}

export {
  InMemoryVoiceRoomRepository,
  SimulatedVoicePlatform,
  type SimulatedVoicePlatformOptions,
} from "./voice-rooms/in-memory-voice-rooms.js";

export { InMemoryMusicSettingsRepository } from "./music/music-settings.js";
export {
  SimulatedMusicBackend,
  type SimulatedMusicBackendOptions,
} from "./music/simulated-music-backend.js";
