import { PermissionFlagsBits, type GuildMember, type Message } from "discord.js";

import type { AppLogger } from "@lunaecho/core";
import type {
  MessageCreateHandler,
  MessageCreateHandlingResult,
} from "../../../infrastructure/discord/discord-event-handler.js";
import type { AutomodDetector } from "../domain/automod-detector.js";
import type { AutomodRuleAction, AutomodRuleSettings } from "@lunaecho/modules";
import { ModerationActionExecutionError, type ModerationActionService } from "@lunaecho/modules";
import type { ModerationCase } from "@lunaecho/modules";
import type { ModerationSettingsService } from "@lunaecho/modules";
import type { DiscordModerationUserNotifier } from "../infrastructure/discord-moderation-user-notifier.js";

export class AutomodMessageFilter implements MessageCreateHandler {
  public constructor(
    private readonly settings: ModerationSettingsService,
    private readonly actions: ModerationActionService,
    private readonly detector: AutomodDetector,
    private readonly notifier: DiscordModerationUserNotifier,
    private readonly logger: AppLogger,
  ) {}

  public async handle(message: Message): Promise<MessageCreateHandlingResult> {
    if (!message.inGuild() || message.author.bot || message.webhookId !== null) {
      return "continue";
    }

    const settings = await this.settings.getSettings(message.guildId);

    if (!settings.automodRules.some((rule) => rule.enabled)) {
      return "continue";
    }

    if (settings.exemptChannelIds.includes(message.channelId)) {
      return "continue";
    }

    if (
      (settings.staffExempt || settings.exemptRoleIds.length > 0) &&
      (await isMemberExempt(message, settings.staffExempt, settings.exemptRoleIds))
    ) {
      return "continue";
    }

    const detection = await this.detector.detect(message, settings.automodRules);

    if (detection === undefined) {
      return "continue";
    }

    const rule = requireRule(settings.automodRules, detection.kind);
    const caseAction = actionToCaseAction(rule.action);
    const request = {
      action: caseAction,
      guildId: message.guildId,
      moderatorUserId: message.client.user.id,
      reason: `AutoMod: ${detection.kind}`,
      targetUserId: message.author.id,
      ...(rule.action === "delete-and-timeout" ? { durationSeconds: rule.timeoutSeconds } : {}),
    } as const;

    try {
      const completed = await this.actions.execute(request, async (moderationCase) => {
        if (rule.action !== "log-only") {
          await message.delete();
        }

        if (rule.action === "delete-and-timeout") {
          const member = await resolveMember(message);

          if (!member.moderatable) {
            throw new Error("AutoMod target is not moderatable by the bot");
          }

          await member.timeout(
            rule.timeoutSeconds * 1_000,
            createAutomodAuditReason(moderationCase, detection.kind),
          );
        }
      });

      if (rule.action === "delete-and-warn" || rule.action === "delete-and-timeout") {
        await this.notifier.notify(
          message.author,
          message.guild.name,
          completed.moderationCase,
          settings.dmNotificationsEnabled,
        );
      }

      this.logger.info(
        {
          authorId: message.author.id,
          caseNumber: completed.moderationCase.caseNumber,
          channelId: message.channelId,
          guildId: message.guildId,
          messageId: message.id,
          ruleAction: rule.action,
          ruleKind: rule.kind,
          safetyConfidence: detection.safetyConfidence,
          safetyProvider: detection.safetyProvider,
        },
        "AutoMod rule enforced",
      );
      return rule.action === "log-only" ? "continue" : "stop";
    } catch (error) {
      if (error instanceof ModerationActionExecutionError) {
        return "continue";
      }

      throw error;
    }
  }
}

function actionToCaseAction(action: AutomodRuleAction): "automod" | "timeout" | "warn" {
  switch (action) {
    case "delete-and-timeout":
      return "timeout";
    case "delete-and-warn":
      return "warn";
    case "delete":
    case "log-only":
      return "automod";
  }
}

function requireRule(
  rules: readonly AutomodRuleSettings[],
  kind: AutomodRuleSettings["kind"],
): AutomodRuleSettings {
  const rule = rules.find((candidate) => candidate.kind === kind);

  if (rule === undefined) {
    throw new TypeError(`AutoMod detection returned unconfigured rule '${kind}'`);
  }

  return rule;
}

async function resolveMember(message: Message<true>): Promise<GuildMember> {
  return message.member ?? message.guild.members.fetch(message.author.id);
}

function createAutomodAuditReason(moderationCase: ModerationCase, ruleKind: string): string {
  return `Luna AutoMod case #${moderationCase.caseNumber} | Rule ${ruleKind}`;
}

async function isMemberExempt(
  message: Message<true>,
  staffExempt: boolean,
  exemptRoleIds: readonly string[],
): Promise<boolean> {
  const member = await resolveMember(message);

  if (
    staffExempt &&
    member.permissions.any([
      PermissionFlagsBits.ManageMessages,
      PermissionFlagsBits.ModerateMembers,
      PermissionFlagsBits.KickMembers,
      PermissionFlagsBits.BanMembers,
    ])
  ) {
    return true;
  }

  return exemptRoleIds.some((roleId) => member.roles.cache.has(roleId));
}
