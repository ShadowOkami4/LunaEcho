import { ExpiringCache, type Clock } from "@lunaecho/core";

import {
  AutomodThresholdInputError,
  createAutomodProfileRules,
  validateAutomodThreshold,
  type AutomodRuleAction,
  type AutomodRuleKind,
  type AutomodRuleSettings,
  type AutomodRuleThreshold,
  type ConfigurableAutomodProfile,
} from "./automod-rule.js";
import {
  maximumBannedWordLength,
  maximumAutomodExemptionsPerType,
  maximumBannedWordsPerGuild,
  minimumBannedWordLength,
  type AddBannedWordResult,
  type ExemptionMutationResult,
  type GuildModerationSettings,
} from "./moderation-settings.js";
import type { ModerationSettingsRepository } from "./moderation-settings-repository.js";

export class BannedWordInputError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "BannedWordInputError";
  }
}

export type BannedWordMutationResult = Readonly<{
  displayValue: string;
  status: AddBannedWordResult | "not-found" | "removed";
}>;

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function containsForbiddenCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return (
      codePoint === undefined ||
      codePoint <= 0x1f ||
      codePoint === 0x7f ||
      (codePoint >= 0x200b && codePoint <= 0x200d) ||
      codePoint === 0xfeff
    );
  });
}

function prepareBannedWord(input: string): Readonly<{
  displayValue: string;
  normalizedValue: string;
}> {
  const compatibilityNormalized = input.normalize("NFKC");

  if (containsForbiddenCharacter(compatibilityNormalized)) {
    throw new BannedWordInputError("Control and zero-width characters are not allowed.");
  }

  const displayValue = compatibilityNormalized.trim().replace(/\s+/gu, " ");
  const characterCount = Array.from(graphemeSegmenter.segment(displayValue)).length;

  if (characterCount < minimumBannedWordLength) {
    throw new BannedWordInputError(
      `A banned word or phrase must contain at least ${minimumBannedWordLength} characters.`,
    );
  }

  if (characterCount > maximumBannedWordLength) {
    throw new BannedWordInputError(
      `A banned word or phrase cannot exceed ${maximumBannedWordLength} characters.`,
    );
  }

  return {
    displayValue,
    normalizedValue: displayValue.toLowerCase(),
  };
}

export class ModerationSettingsService {
  private readonly settingsCache: ExpiringCache<string, GuildModerationSettings>;

  /**
   * One cached guild costs 2 KB without banned words and 28 KB with the maximum of 100, so the
   * default of 2,000 guilds bounds this cache between 4 MB and 57 MB.
   */
  public constructor(
    private readonly repository: ModerationSettingsRepository,
    private readonly clock: Clock = () => new Date(),
    cacheTtlMilliseconds = 30_000,
    maximumCachedGuilds = 2_000,
  ) {
    this.settingsCache = new ExpiringCache({
      clock: this.clock,
      maximumEntries: maximumCachedGuilds,
      ttlMilliseconds: cacheTtlMilliseconds,
    });
  }

  public async addBannedWord(
    guildId: string,
    input: string,
    actorId: string,
  ): Promise<BannedWordMutationResult> {
    const word = prepareBannedWord(input);
    const status = await this.repository.addBannedWord(
      {
        ...word,
        createdAt: this.clock(),
        createdBy: actorId,
        guildId,
      },
      maximumBannedWordsPerGuild,
    );

    if (status === "added") {
      this.settingsCache.delete(guildId);
    }

    return { displayValue: word.displayValue, status };
  }

  /** Drops the cached settings, for example after the dashboard changed them. */
  public invalidate(guildId: string): void {
    this.settingsCache.delete(guildId);
  }

  public async getSettings(guildId: string): Promise<GuildModerationSettings> {
    const cached = this.settingsCache.get(guildId);

    if (cached !== undefined) {
      return cached;
    }

    const settings = await this.repository.getByGuildId(guildId);
    this.settingsCache.set(guildId, settings);
    return settings;
  }

  public async applyAutomodProfile(
    guildId: string,
    profile: ConfigurableAutomodProfile,
    actorId: string,
  ): Promise<void> {
    await this.repository.applyAutomodProfile(
      guildId,
      profile,
      createAutomodProfileRules(profile),
      actorId,
      this.clock(),
    );
    this.settingsCache.delete(guildId);
  }

  public async removeBannedWord(guildId: string, input: string): Promise<BannedWordMutationResult> {
    const word = prepareBannedWord(input);
    const removed = await this.repository.removeBannedWord(
      guildId,
      word.normalizedValue,
      this.clock(),
    );

    if (removed) {
      this.settingsCache.delete(guildId);
    }

    return {
      displayValue: word.displayValue,
      status: removed ? "removed" : "not-found",
    };
  }

  public async setAutomodRuleAction(
    guildId: string,
    ruleKind: AutomodRuleKind,
    action: AutomodRuleAction,
    actorId: string,
  ): Promise<AutomodRuleSettings> {
    const settings = await this.repository.setAutomodRuleAction(
      guildId,
      ruleKind,
      action,
      actorId,
      this.clock(),
    );
    this.settingsCache.delete(guildId);
    return settings;
  }

  public async setAutomodRuleThreshold(
    guildId: string,
    ruleKind: AutomodRuleKind,
    threshold: AutomodRuleThreshold,
    actorId: string,
  ): Promise<AutomodRuleSettings> {
    const validatedThreshold = validateAutomodThreshold(ruleKind, threshold);
    const settings = await this.repository.setAutomodRuleThreshold(
      guildId,
      ruleKind,
      validatedThreshold,
      actorId,
      this.clock(),
    );
    this.settingsCache.delete(guildId);
    return settings;
  }

  public async setAutomodRuleTimeout(
    guildId: string,
    ruleKind: AutomodRuleKind,
    timeoutSeconds: number,
    actorId: string,
  ): Promise<AutomodRuleSettings> {
    if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 300 || timeoutSeconds > 86_400) {
      throw new AutomodThresholdInputError(
        "The automatic timeout must be between 5 minutes and 24 hours.",
      );
    }

    const settings = await this.repository.setAutomodRuleTimeout(
      guildId,
      ruleKind,
      timeoutSeconds,
      actorId,
      this.clock(),
    );
    this.settingsCache.delete(guildId);
    return settings;
  }

  public async toggleBannedWords(guildId: string): Promise<boolean> {
    const enabled = await this.repository.toggleBannedWords(guildId, this.clock());
    this.settingsCache.delete(guildId);
    return enabled;
  }

  public async toggleDmNotifications(guildId: string): Promise<boolean> {
    const enabled = await this.repository.toggleDmNotifications(guildId, this.clock());
    this.settingsCache.delete(guildId);
    return enabled;
  }

  public async toggleExemptChannel(
    guildId: string,
    channelId: string,
    actorId: string,
  ): Promise<ExemptionMutationResult> {
    const result = await this.repository.toggleExemptChannel(
      guildId,
      channelId,
      actorId,
      maximumAutomodExemptionsPerType,
      this.clock(),
    );
    this.settingsCache.delete(guildId);
    return result;
  }

  public async toggleExemptRole(
    guildId: string,
    roleId: string,
    actorId: string,
  ): Promise<ExemptionMutationResult> {
    const result = await this.repository.toggleExemptRole(
      guildId,
      roleId,
      actorId,
      maximumAutomodExemptionsPerType,
      this.clock(),
    );
    this.settingsCache.delete(guildId);
    return result;
  }

  public async toggleStaffExempt(guildId: string): Promise<boolean> {
    const enabled = await this.repository.toggleStaffExempt(guildId, this.clock());
    this.settingsCache.delete(guildId);
    return enabled;
  }

  public async toggleAutomodRule(
    guildId: string,
    ruleKind: AutomodRuleKind,
    actorId: string,
  ): Promise<AutomodRuleSettings> {
    const settings = await this.repository.toggleAutomodRule(
      guildId,
      ruleKind,
      actorId,
      this.clock(),
    );
    this.settingsCache.delete(guildId);
    return settings;
  }
}
