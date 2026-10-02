export const moderationActions = [
  "automod",
  "warn",
  "timeout",
  "untimeout",
  "kick",
  "ban",
  "unban",
  "purge",
] as const;

export const moderationCaseStatuses = ["pending", "completed", "failed"] as const;

export type ModerationAction = (typeof moderationActions)[number];
export type ModerationCaseStatus = (typeof moderationCaseStatuses)[number];

export type ModerationCase = Readonly<{
  action: ModerationAction;
  caseNumber: number;
  completedAt: Date | null;
  createdAt: Date;
  durationSeconds: number | null;
  failureCode: string | null;
  guildId: string;
  moderatorUserId: string;
  reason: string;
  status: ModerationCaseStatus;
  targetUserId: string | null;
}>;

export type NewModerationCase = Readonly<{
  action: ModerationAction;
  createdAt: Date;
  durationSeconds?: number;
  guildId: string;
  moderatorUserId: string;
  reason: string;
  targetUserId?: string;
}>;
