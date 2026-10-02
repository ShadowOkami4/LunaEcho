import { MessageFlags, escapeMarkdown, type User } from "discord.js";

import type { AppLogger } from "@lunaecho/core";
import { createPanel } from "../../../infrastructure/discord/components/panel.js";
import type { ModerationAction, ModerationCase } from "@lunaecho/modules";

export type ModerationNotificationResult = "disabled" | "sent" | "unavailable";

const notificationActionNames = {
  automod: "Automated moderation",
  ban: "Ban",
  kick: "Kick",
  purge: "Message purge",
  timeout: "Timeout",
  unban: "Ban removed",
  untimeout: "Timeout removed",
  warn: "Warning",
} as const satisfies Readonly<Record<ModerationAction, string>>;

export class DiscordModerationUserNotifier {
  public constructor(private readonly logger: AppLogger) {}

  public async notify(
    user: User,
    guildName: string,
    moderationCase: ModerationCase,
    enabled: boolean,
  ): Promise<ModerationNotificationResult> {
    if (!enabled) {
      return "disabled";
    }

    const duration =
      moderationCase.durationSeconds === null
        ? ""
        : `\n**Duration:** ${formatDuration(moderationCase.durationSeconds)}`;

    try {
      await user.send({
        allowedMentions: { parse: [] },
        components: [
          createPanel({
            body: `A moderation action was recorded in **${escapeMarkdown(guildName)}**.\n\n**Action:** ${notificationActionNames[moderationCase.action]}${duration}\n**Case:** #${moderationCase.caseNumber}\n**Reason:** ${escapeMarkdown(moderationCase.reason)}`,
            footer: "Contact the server's moderation team if you need clarification.",
            title: "Moderation notice",
            tone: moderationCase.action === "untimeout" ? "info" : "warning",
          }),
        ],
        flags: MessageFlags.IsComponentsV2,
      });
      this.logger.info(
        {
          action: moderationCase.action,
          caseNumber: moderationCase.caseNumber,
          guildId: moderationCase.guildId,
          targetUserId: user.id,
        },
        "Moderation notice delivered",
      );
      return "sent";
    } catch {
      this.logger.info(
        {
          action: moderationCase.action,
          caseNumber: moderationCase.caseNumber,
          guildId: moderationCase.guildId,
          targetUserId: user.id,
        },
        "Moderation notice could not be delivered",
      );
      return "unavailable";
    }
  }
}

function formatDuration(durationSeconds: number): string {
  if (durationSeconds % 86_400 === 0) {
    return `${durationSeconds / 86_400} day(s)`;
  }

  if (durationSeconds % 3_600 === 0) {
    return `${durationSeconds / 3_600} hour(s)`;
  }

  return `${durationSeconds / 60} minute(s)`;
}
