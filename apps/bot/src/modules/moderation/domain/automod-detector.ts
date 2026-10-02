import type { Message } from "discord.js";

import type { AutomodRuleKind, AutomodRuleSettings } from "@lunaecho/modules";
import type { MessageSafetyClassifier } from "./message-safety-classifier.js";

export type AutomodDetection = Readonly<{
  kind: AutomodRuleKind;
  safetyConfidence?: number;
  safetyProvider?: string;
}>;

type MessageActivity = Readonly<{
  channelId: string;
  timestamp: number;
}>;

const detectionCooldownMilliseconds = 15_000;
const maximumActivityWindowMilliseconds = 60_000;
const invitePattern =
  /(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord(?:app)?\.com\/invite)\/[a-z0-9-]+/iu;
const customEmojiPattern = /<a?:[a-z0-9_]+:\d{17,20}>/giu;
const unicodeEmojiPattern = /\p{Extended_Pictographic}/gu;

export class AutomodDetector {
  private readonly activityByMember = new Map<string, MessageActivity[]>();
  private readonly cooldowns = new Map<string, number>();

  public constructor(
    private readonly safetyClassifier: MessageSafetyClassifier,
    private readonly now: () => number = Date.now,
  ) {}

  public async detect(
    message: Message<true>,
    rules: readonly AutomodRuleSettings[],
  ): Promise<AutomodDetection | undefined> {
    const timestamp = this.now();
    const activity = this.recordActivity(message, timestamp);
    const enabledRules = new Map(
      rules.filter((rule) => rule.enabled).map((rule) => [rule.kind, rule] as const),
    );

    const safetyRule = enabledRules.get("threats-and-identity-attacks");

    if (safetyRule !== undefined) {
      const assessment = await this.safetyClassifier.classify(message.content);

      if (
        assessment.label !== "none" &&
        assessment.confidence >= safetyRule.threshold.triggerLimit / 100 &&
        !this.isCoolingDown(message, "threats-and-identity-attacks", timestamp)
      ) {
        this.startCooldown(message, "threats-and-identity-attacks", timestamp);
        return {
          kind: "threats-and-identity-attacks",
          safetyConfidence: assessment.confidence,
          safetyProvider: assessment.provider,
        };
      }
    }

    const statelessKind = this.detectStateless(message, enabledRules);

    if (statelessKind !== undefined && !this.isCoolingDown(message, statelessKind, timestamp)) {
      this.startCooldown(message, statelessKind, timestamp);
      return { kind: statelessKind };
    }

    const crossChannelRule = enabledRules.get("cross-channel-spam");
    const crossChannelWindow = (crossChannelRule?.threshold.windowSeconds ?? 12) * 1_000;
    const crossChannelActivity = activity.filter(
      (entry) => entry.timestamp >= timestamp - crossChannelWindow,
    );

    if (
      crossChannelRule !== undefined &&
      crossChannelActivity.length >= crossChannelRule.threshold.triggerLimit &&
      new Set(crossChannelActivity.map((entry) => entry.channelId)).size >=
        (crossChannelRule.threshold.secondaryLimit ?? 3) &&
      !this.isCoolingDown(message, "cross-channel-spam", timestamp)
    ) {
      this.startCooldown(message, "cross-channel-spam", timestamp);
      return { kind: "cross-channel-spam" };
    }

    const floodRule = enabledRules.get("message-flood");
    const floodWindow = (floodRule?.threshold.windowSeconds ?? 8) * 1_000;
    const sameChannelFlood = activity.filter(
      (entry) =>
        entry.channelId === message.channelId && entry.timestamp >= timestamp - floodWindow,
    );

    if (
      floodRule !== undefined &&
      sameChannelFlood.length >= floodRule.threshold.triggerLimit &&
      !this.isCoolingDown(message, "message-flood", timestamp)
    ) {
      this.startCooldown(message, "message-flood", timestamp);
      return { kind: "message-flood" };
    }

    return undefined;
  }

  private detectStateless(
    message: Message<true>,
    enabledRules: ReadonlyMap<AutomodRuleKind, AutomodRuleSettings>,
  ): AutomodRuleKind | undefined {
    if (enabledRules.has("invite-links") && invitePattern.test(message.content)) {
      return "invite-links";
    }

    if (enabledRules.has("polls") && message.poll !== null) {
      return "polls";
    }

    if (
      enabledRules.has("mention-spam") &&
      (message.mentions.everyone ||
        message.mentions.users.size + message.mentions.roles.size >=
          requireRule(enabledRules, "mention-spam").threshold.triggerLimit)
    ) {
      return "mention-spam";
    }

    if (
      enabledRules.has("attachment-spam") &&
      message.attachments.size >=
        requireRule(enabledRules, "attachment-spam").threshold.triggerLimit
    ) {
      return "attachment-spam";
    }

    if (
      enabledRules.has("emoji-spam") &&
      countEmoji(message.content) >= requireRule(enabledRules, "emoji-spam").threshold.triggerLimit
    ) {
      return "emoji-spam";
    }

    if (
      enabledRules.has("large-message") &&
      message.content.length >= requireRule(enabledRules, "large-message").threshold.triggerLimit
    ) {
      return "large-message";
    }

    const capsRule = enabledRules.get("excessive-caps");

    if (capsRule !== undefined && hasExcessiveCaps(message.content, capsRule)) {
      return "excessive-caps";
    }

    return undefined;
  }

  private isCoolingDown(message: Message<true>, kind: AutomodRuleKind, timestamp: number): boolean {
    const cooldown = this.cooldowns.get(createRuleKey(message, kind));
    return cooldown !== undefined && cooldown > timestamp;
  }

  private recordActivity(message: Message<true>, timestamp: number): readonly MessageActivity[] {
    const memberKey = `${message.guildId}:${message.author.id}`;
    const existing = this.activityByMember.get(memberKey) ?? [];
    const active = existing.filter(
      (entry) => entry.timestamp >= timestamp - maximumActivityWindowMilliseconds,
    );
    active.push({ channelId: message.channelId, timestamp });

    this.activityByMember.delete(memberKey);
    this.activityByMember.set(memberKey, active);
    trimOldestMapEntry(this.activityByMember, 10_000);
    return active;
  }

  private startCooldown(message: Message<true>, kind: AutomodRuleKind, timestamp: number): void {
    const key = createRuleKey(message, kind);
    this.cooldowns.delete(key);
    this.cooldowns.set(key, timestamp + detectionCooldownMilliseconds);
    trimOldestMapEntry(this.cooldowns, 10_000);
  }
}

function countEmoji(content: string): number {
  const customEmojiCount = [...content.matchAll(customEmojiPattern)].length;
  const unicodeEmojiCount = [...content.matchAll(unicodeEmojiPattern)].length;
  return customEmojiCount + unicodeEmojiCount;
}

function hasExcessiveCaps(content: string, rule: AutomodRuleSettings): boolean {
  const letters = content.match(/\p{L}/gu) ?? [];

  if (letters.length < rule.threshold.triggerLimit) {
    return false;
  }

  const uppercaseLetters = letters.filter(
    (letter) => letter === letter.toLocaleUpperCase() && letter !== letter.toLocaleLowerCase(),
  );
  return uppercaseLetters.length / letters.length >= (rule.threshold.secondaryLimit ?? 75) / 100;
}

function createRuleKey(message: Message<true>, kind: AutomodRuleKind): string {
  return `${message.guildId}:${message.author.id}:${kind}`;
}

function trimOldestMapEntry<Key, Value>(map: Map<Key, Value>, maximumSize: number): void {
  if (map.size <= maximumSize) {
    return;
  }

  const oldestKey = map.keys().next().value;

  if (oldestKey !== undefined) {
    map.delete(oldestKey);
  }
}

function requireRule(
  rules: ReadonlyMap<AutomodRuleKind, AutomodRuleSettings>,
  kind: AutomodRuleKind,
): AutomodRuleSettings {
  const rule = rules.get(kind);

  if (rule === undefined) {
    throw new TypeError(`Enabled AutoMod rule '${kind}' was not found`);
  }

  return rule;
}
