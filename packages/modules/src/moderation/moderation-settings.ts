import type { AutomodProfile, AutomodRuleSettings } from "./automod-rule.js";

export const maximumBannedWordsPerGuild = 100;
export const maximumBannedWordLength = 64;
export const minimumBannedWordLength = 2;
export const maximumAutomodExemptionsPerType = 25;

export type BannedWord = Readonly<{
  createdAt: Date;
  createdBy: string;
  displayValue: string;
  normalizedValue: string;
}>;

export type GuildModerationSettings = Readonly<{
  automodProfile: AutomodProfile;
  automodRules: readonly AutomodRuleSettings[];
  bannedWords: readonly BannedWord[];
  bannedWordsEnabled: boolean;
  dmNotificationsEnabled: boolean;
  exemptChannelIds: readonly string[];
  exemptRoleIds: readonly string[];
  guildId: string;
  staffExempt: boolean;
}>;

export type NewBannedWord = Readonly<{
  createdAt: Date;
  createdBy: string;
  displayValue: string;
  guildId: string;
  normalizedValue: string;
}>;

export type AddBannedWordResult = "added" | "already-exists" | "limit-reached";
export type ExemptionMutationResult = "added" | "limit-reached" | "removed";
