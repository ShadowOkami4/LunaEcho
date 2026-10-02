import type {
  AutomodProfile,
  AutomodRuleAction,
  AutomodRuleKind,
  AutomodRuleSettings,
} from "./automod-rule.js";

export type AutomodRulePresentation = Readonly<{
  description: string;
  emoji: string;
  label: string;
}>;

export const automodRuleCatalog = {
  "attachment-spam": {
    description: "Stops messages that dump too many files at once.",
    emoji: "📎",
    label: "Attachment spam",
  },
  "cross-channel-spam": {
    description: "Detects rapid posting across several server channels.",
    emoji: "🗂️",
    label: "Cross-channel spam",
  },
  "emoji-spam": {
    description: "Stops messages dominated by custom or Unicode emoji.",
    emoji: "😀",
    label: "Emoji spam",
  },
  "excessive-caps": {
    description: "Detects shouting while ignoring short messages and ordinary acronyms.",
    emoji: "🔠",
    label: "Excessive caps",
  },
  "invite-links": {
    description: "Detects Discord invite links in message text.",
    emoji: "🔗",
    label: "Discord invites",
  },
  "large-message": {
    description: "Stops oversized text blocks that disrupt a channel.",
    emoji: "📜",
    label: "Large messages",
  },
  "mention-spam": {
    description: "Stops mass pings to users, roles, @everyone, or @here.",
    emoji: "📣",
    label: "Mention spam",
  },
  "message-flood": {
    description: "Detects rapid message flooding inside one channel.",
    emoji: "🌊",
    label: "Message flood",
  },
  polls: {
    description: "Controls Discord poll messages when polls are not wanted.",
    emoji: "📊",
    label: "Polls",
  },
  "threats-and-identity-attacks": {
    description:
      "Conservatively classifies explicit violent threats and calls for harm against identity groups.",
    emoji: "🛡️",
    label: "Threats & identity attacks",
  },
} as const satisfies Readonly<Record<AutomodRuleKind, AutomodRulePresentation>>;

export const automodActionNames = {
  delete: "Delete message",
  "delete-and-timeout": "Delete + timeout",
  "delete-and-warn": "Delete + record warning",
  "log-only": "Log and record only",
} as const satisfies Readonly<Record<AutomodRuleAction, string>>;

export const automodActionDescriptions = {
  delete: "Remove the detected message and record an AutoMod case.",
  "delete-and-timeout": "Remove it, apply the configured timeout, and record a case.",
  "delete-and-warn": "Remove it and add a warning to the member's case history.",
  "log-only": "Keep the message, write a privacy-safe log, and record an AutoMod case.",
} as const satisfies Readonly<Record<AutomodRuleAction, string>>;

export const automodProfileNames = {
  balanced: "Balanced",
  custom: "Custom",
  off: "Off",
  relaxed: "Relaxed",
  strict: "Strict",
} as const satisfies Readonly<Record<AutomodProfile, string>>;

export const automodProfileDescriptions = {
  balanced: "Recommended protection for most communities.",
  custom: "One or more rules were tuned manually.",
  off: "Disable all spam and content rules.",
  relaxed: "Higher thresholds with fewer automatic actions.",
  strict: "Lower thresholds and stronger responses for high-risk servers.",
} as const satisfies Readonly<Record<AutomodProfile, string>>;

export function formatAutomodThreshold(rule: AutomodRuleSettings): string {
  const { secondaryLimit, triggerLimit, windowSeconds } = rule.threshold;

  switch (rule.kind) {
    case "message-flood":
      return `${triggerLimit} messages in one channel within ${windowSeconds ?? 8} seconds`;
    case "cross-channel-spam":
      return `${triggerLimit} messages across ${secondaryLimit ?? 3} channels within ${windowSeconds ?? 12} seconds`;
    case "mention-spam":
      return `${triggerLimit} unique mentions, or an everyone/here mention`;
    case "attachment-spam":
      return `${triggerLimit} attachments in one message`;
    case "emoji-spam":
      return `${triggerLimit} emoji in one message`;
    case "large-message":
      return `${triggerLimit.toLocaleString("en-US")} characters`;
    case "excessive-caps":
      return `${triggerLimit} letters with ${secondaryLimit ?? 75}% uppercase`;
    case "invite-links":
      return "Any discord.gg or discord.com/invite link";
    case "polls":
      return "Any Discord poll message";
    case "threats-and-identity-attacks":
      return `${triggerLimit}% classifier confidence`;
  }
}
