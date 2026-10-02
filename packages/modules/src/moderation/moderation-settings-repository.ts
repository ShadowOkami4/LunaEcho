import type {
  AutomodProfile,
  AutomodRuleAction,
  AutomodRuleKind,
  AutomodRuleSettings,
  AutomodRuleThreshold,
  ConfigurableAutomodProfile,
} from "./automod-rule.js";
import type {
  AddBannedWordResult,
  ExemptionMutationResult,
  GuildModerationSettings,
  NewBannedWord,
} from "./moderation-settings.js";

export interface ModerationSettingsRepository {
  addBannedWord(word: NewBannedWord, maximumWords: number): Promise<AddBannedWordResult>;
  applyAutomodProfile(
    guildId: string,
    profile: ConfigurableAutomodProfile,
    rules: readonly AutomodRuleSettings[],
    actorId: string,
    updatedAt: Date,
  ): Promise<void>;
  getByGuildId(guildId: string): Promise<GuildModerationSettings>;
  removeBannedWord(guildId: string, normalizedValue: string, updatedAt: Date): Promise<boolean>;
  setAutomodRuleAction(
    guildId: string,
    ruleKind: AutomodRuleKind,
    action: AutomodRuleAction,
    actorId: string,
    updatedAt: Date,
  ): Promise<AutomodRuleSettings>;
  setAutomodRuleThreshold(
    guildId: string,
    ruleKind: AutomodRuleKind,
    threshold: AutomodRuleThreshold,
    actorId: string,
    updatedAt: Date,
  ): Promise<AutomodRuleSettings>;
  setAutomodRuleTimeout(
    guildId: string,
    ruleKind: AutomodRuleKind,
    timeoutSeconds: number,
    actorId: string,
    updatedAt: Date,
  ): Promise<AutomodRuleSettings>;
  toggleBannedWords(guildId: string, updatedAt: Date): Promise<boolean>;
  toggleDmNotifications(guildId: string, updatedAt: Date): Promise<boolean>;
  toggleExemptChannel(
    guildId: string,
    channelId: string,
    actorId: string,
    maximumExemptions: number,
    updatedAt: Date,
  ): Promise<ExemptionMutationResult>;
  toggleExemptRole(
    guildId: string,
    roleId: string,
    actorId: string,
    maximumExemptions: number,
    updatedAt: Date,
  ): Promise<ExemptionMutationResult>;
  toggleStaffExempt(guildId: string, updatedAt: Date): Promise<boolean>;
  toggleAutomodRule(
    guildId: string,
    ruleKind: AutomodRuleKind,
    actorId: string,
    updatedAt: Date,
  ): Promise<AutomodRuleSettings>;
}

export function isStoredAutomodProfile(value: string): value is AutomodProfile {
  return ["off", "relaxed", "balanced", "strict", "custom"].includes(value);
}
