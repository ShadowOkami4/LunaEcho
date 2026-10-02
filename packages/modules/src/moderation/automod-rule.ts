export const automodRuleKinds = [
  "message-flood",
  "cross-channel-spam",
  "mention-spam",
  "attachment-spam",
  "emoji-spam",
  "large-message",
  "excessive-caps",
  "invite-links",
  "polls",
  "threats-and-identity-attacks",
] as const;

export const automodRuleActions = [
  "log-only",
  "delete",
  "delete-and-warn",
  "delete-and-timeout",
] as const;

export const automodProfiles = ["off", "relaxed", "balanced", "strict", "custom"] as const;

export type AutomodRuleKind = (typeof automodRuleKinds)[number];
export type AutomodRuleAction = (typeof automodRuleActions)[number];
export type AutomodProfile = (typeof automodProfiles)[number];
export type ConfigurableAutomodProfile = Exclude<AutomodProfile, "custom">;

export type AutomodRuleThreshold = Readonly<{
  secondaryLimit: number | null;
  triggerLimit: number;
  windowSeconds: number | null;
}>;

export type AutomodRuleSettings = Readonly<{
  action: AutomodRuleAction;
  enabled: boolean;
  kind: AutomodRuleKind;
  threshold: AutomodRuleThreshold;
  timeoutSeconds: number;
}>;

export type AutomodThresholdField = "secondaryLimit" | "triggerLimit" | "windowSeconds";

export type AutomodThresholdConstraint = Readonly<{
  description: string;
  field: AutomodThresholdField;
  label: string;
  maximum: number;
  minimum: number;
}>;

export class AutomodThresholdInputError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "AutomodThresholdInputError";
  }
}

const defaultActions = {
  "attachment-spam": "delete-and-warn",
  "cross-channel-spam": "delete-and-warn",
  "emoji-spam": "delete-and-warn",
  "excessive-caps": "log-only",
  "invite-links": "delete",
  "large-message": "delete",
  "mention-spam": "delete-and-warn",
  "message-flood": "delete-and-warn",
  polls: "delete",
  "threats-and-identity-attacks": "log-only",
} as const satisfies Readonly<Record<AutomodRuleKind, AutomodRuleAction>>;

const defaultThresholds = {
  "attachment-spam": { secondaryLimit: null, triggerLimit: 4, windowSeconds: null },
  "cross-channel-spam": { secondaryLimit: 3, triggerLimit: 4, windowSeconds: 12 },
  "emoji-spam": { secondaryLimit: null, triggerLimit: 10, windowSeconds: null },
  "excessive-caps": { secondaryLimit: 75, triggerLimit: 20, windowSeconds: null },
  "invite-links": { secondaryLimit: null, triggerLimit: 1, windowSeconds: null },
  "large-message": { secondaryLimit: null, triggerLimit: 1_500, windowSeconds: null },
  "mention-spam": { secondaryLimit: null, triggerLimit: 5, windowSeconds: null },
  "message-flood": { secondaryLimit: null, triggerLimit: 5, windowSeconds: 8 },
  polls: { secondaryLimit: null, triggerLimit: 1, windowSeconds: null },
  "threats-and-identity-attacks": {
    secondaryLimit: null,
    triggerLimit: 90,
    windowSeconds: null,
  },
} as const satisfies Readonly<Record<AutomodRuleKind, AutomodRuleThreshold>>;

const thresholdConstraints = {
  "attachment-spam": [
    constraint("triggerLimit", "Attachments", "Attachments in one message", 2, 10),
  ],
  "cross-channel-spam": [
    constraint("triggerLimit", "Messages", "Messages required to trigger", 3, 12),
    constraint("secondaryLimit", "Channels", "Different channels required", 2, 8),
    constraint("windowSeconds", "Window (seconds)", "Tracking window", 5, 60),
  ],
  "emoji-spam": [constraint("triggerLimit", "Emoji", "Emoji in one message", 5, 30)],
  "excessive-caps": [
    constraint("triggerLimit", "Minimum letters", "Shorter messages are ignored", 10, 100),
    constraint("secondaryLimit", "Uppercase percent", "Percentage required to trigger", 50, 100),
  ],
  "invite-links": [],
  "large-message": [
    constraint("triggerLimit", "Characters", "Message length required to trigger", 500, 2_000),
  ],
  "mention-spam": [
    constraint("triggerLimit", "Mentions", "Unique mentions required to trigger", 2, 20),
  ],
  "message-flood": [
    constraint("triggerLimit", "Messages", "Messages required to trigger", 3, 12),
    constraint("windowSeconds", "Window (seconds)", "Tracking window", 3, 30),
  ],
  polls: [],
  "threats-and-identity-attacks": [
    constraint("triggerLimit", "Confidence percent", "Minimum classifier confidence", 80, 100),
  ],
} as const satisfies Readonly<Record<AutomodRuleKind, readonly AutomodThresholdConstraint[]>>;

type AutomodRuleOverride = Readonly<{
  action?: AutomodRuleAction;
  threshold?: Partial<AutomodRuleThreshold>;
  timeoutSeconds?: number;
}>;

const presetOverrides: Readonly<
  Record<
    ConfigurableAutomodProfile,
    Readonly<Partial<Record<AutomodRuleKind, AutomodRuleOverride>>>
  >
> = {
  balanced: {},
  off: {},
  relaxed: {
    "attachment-spam": { threshold: { triggerLimit: 6 } },
    "cross-channel-spam": {
      threshold: { secondaryLimit: 4, triggerLimit: 6, windowSeconds: 15 },
    },
    "emoji-spam": { threshold: { triggerLimit: 16 } },
    "large-message": { threshold: { triggerLimit: 1_900 } },
    "mention-spam": { threshold: { triggerLimit: 8 } },
    "message-flood": { threshold: { triggerLimit: 8, windowSeconds: 8 } },
  },
  strict: {
    "attachment-spam": { threshold: { triggerLimit: 3 } },
    "cross-channel-spam": {
      action: "delete-and-timeout",
      threshold: { secondaryLimit: 3, triggerLimit: 4, windowSeconds: 10 },
      timeoutSeconds: 1_800,
    },
    "emoji-spam": { threshold: { triggerLimit: 8 } },
    "excessive-caps": {
      action: "delete-and-warn",
      threshold: { secondaryLimit: 70, triggerLimit: 20 },
    },
    "large-message": { threshold: { triggerLimit: 1_200 } },
    "mention-spam": {
      action: "delete-and-timeout",
      threshold: { triggerLimit: 4 },
      timeoutSeconds: 1_800,
    },
    "message-flood": {
      action: "delete-and-timeout",
      threshold: { triggerLimit: 4, windowSeconds: 6 },
      timeoutSeconds: 1_800,
    },
    "threats-and-identity-attacks": { threshold: { triggerLimit: 90 } },
  },
};

const enabledByProfile = {
  balanced: new Set<AutomodRuleKind>([
    "message-flood",
    "cross-channel-spam",
    "mention-spam",
    "attachment-spam",
    "emoji-spam",
    "large-message",
    "invite-links",
  ]),
  off: new Set<AutomodRuleKind>(),
  relaxed: new Set<AutomodRuleKind>([
    "message-flood",
    "cross-channel-spam",
    "mention-spam",
    "attachment-spam",
    "emoji-spam",
    "invite-links",
  ]),
  strict: new Set<AutomodRuleKind>(automodRuleKinds),
} as const satisfies Readonly<Record<ConfigurableAutomodProfile, ReadonlySet<AutomodRuleKind>>>;

export function createDefaultAutomodRules(): readonly AutomodRuleSettings[] {
  return createAutomodProfileRules("off");
}

export function createAutomodProfileRules(
  profile: ConfigurableAutomodProfile,
): readonly AutomodRuleSettings[] {
  return automodRuleKinds.map((kind) => {
    const defaultThreshold = defaultThresholds[kind];
    const override = presetOverrides[profile][kind];
    const thresholdOverride = override?.threshold;

    return {
      action: override?.action ?? defaultActions[kind],
      enabled: enabledByProfile[profile].has(kind),
      kind,
      threshold: {
        secondaryLimit:
          thresholdOverride !== undefined && "secondaryLimit" in thresholdOverride
            ? thresholdOverride.secondaryLimit
            : defaultThreshold.secondaryLimit,
        triggerLimit: thresholdOverride?.triggerLimit ?? defaultThreshold.triggerLimit,
        windowSeconds: thresholdOverride?.windowSeconds ?? defaultThreshold.windowSeconds,
      },
      timeoutSeconds: override?.timeoutSeconds ?? 600,
    };
  });
}

export function getAutomodThresholdConstraints(
  kind: AutomodRuleKind,
): readonly AutomodThresholdConstraint[] {
  return thresholdConstraints[kind];
}

export function validateAutomodThreshold(
  kind: AutomodRuleKind,
  threshold: AutomodRuleThreshold,
): AutomodRuleThreshold {
  for (const thresholdConstraint of thresholdConstraints[kind]) {
    const value = threshold[thresholdConstraint.field];

    if (
      value === null ||
      !Number.isInteger(value) ||
      value < thresholdConstraint.minimum ||
      value > thresholdConstraint.maximum
    ) {
      throw new AutomodThresholdInputError(
        `${thresholdConstraint.label} must be a whole number from ${thresholdConstraint.minimum} to ${thresholdConstraint.maximum}.`,
      );
    }
  }

  return threshold;
}

export function isAutomodProfile(value: string): value is AutomodProfile {
  return automodProfiles.some((profile) => profile === value);
}

export function isConfigurableAutomodProfile(value: string): value is ConfigurableAutomodProfile {
  return value !== "custom" && isAutomodProfile(value);
}

export function isAutomodRuleAction(value: string): value is AutomodRuleAction {
  return automodRuleActions.some((action) => action === value);
}

export function isAutomodRuleKind(value: string): value is AutomodRuleKind {
  return automodRuleKinds.some((kind) => kind === value);
}

function constraint(
  field: AutomodThresholdField,
  label: string,
  description: string,
  minimum: number,
  maximum: number,
): AutomodThresholdConstraint {
  return { description, field, label, maximum, minimum };
}
