import {
  escapeMarkdown,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Guild,
  type GuildMember,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord.js";

import type { AppLogger } from "@lunaecho/core";
import type { ChatInputCommand } from "../../../infrastructure/discord/commands/chat-input-command.js";
import { respondWithPanelEphemerally } from "../../../infrastructure/discord/commands/interaction-responder.js";
import { ModerationActionExecutionError, type ModerationActionService } from "@lunaecho/modules";
import type { ModerationAction, ModerationCase } from "@lunaecho/modules";
import {
  evaluateModerationMemberTarget,
  type ModerationMemberPolicyRejection,
} from "../domain/moderation-member-policy.js";
import type { ModerationSettingsService } from "@lunaecho/modules";
import type {
  DiscordModerationUserNotifier,
  ModerationNotificationResult,
} from "../infrastructure/discord-moderation-user-notifier.js";

const maximumReasonLength = 400;
const maximumTimeoutSeconds = 28 * 24 * 60 * 60;
const snowflakePattern = /^\d{17,20}$/u;

const actionNames = {
  automod: "Automated moderation",
  ban: "Ban",
  kick: "Kick",
  purge: "Message purge",
  timeout: "Timeout",
  unban: "Unban",
  untimeout: "Timeout removal",
  warn: "Warning",
} as const satisfies Readonly<Record<ModerationAction, string>>;

const policyRejectionMessages = {
  "bot-target": "Bots and applications cannot be targeted by this command.",
  "guild-owner": "The server owner cannot be moderated.",
  "higher-or-equal-role":
    "You cannot moderate a member whose highest role is equal to or above yours.",
  "self-target": "You cannot use this moderation action on yourself.",
} as const satisfies Readonly<Record<ModerationMemberPolicyRejection, string>>;

class ModerationCommandRejection extends Error {
  public constructor(
    public readonly code: string,
    public readonly userMessage: string,
  ) {
    super(userMessage);
    this.name = "ModerationCommandRejection";
  }
}

export const moderationActionCommandData: RESTPostAPIChatInputApplicationCommandsJSONBody =
  new SlashCommandBuilder()
    .setName("moderate")
    .setDescription("Run moderation actions and inspect the private case history.")
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("warn")
        .setDescription("Record an official warning for a member.")
        .addUserOption((option) =>
          option.setName("user").setDescription("Member to warn").setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName("reason")
            .setDescription("Reason recorded in the case")
            .setMinLength(2)
            .setMaxLength(maximumReasonLength)
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("timeout")
        .setDescription("Temporarily prevent a member from interacting.")
        .addUserOption((option) =>
          option.setName("user").setDescription("Member to time out").setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName("duration")
            .setDescription("Duration such as 30m, 2h, or 7d (maximum 28d)")
            .setMinLength(2)
            .setMaxLength(6)
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName("reason")
            .setDescription("Reason recorded in the case and Discord audit log")
            .setMinLength(2)
            .setMaxLength(maximumReasonLength)
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("untimeout")
        .setDescription("Remove a member's active timeout.")
        .addUserOption((option) =>
          option.setName("user").setDescription("Member whose timeout to remove").setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName("reason")
            .setDescription("Reason recorded in the case and Discord audit log")
            .setMinLength(2)
            .setMaxLength(maximumReasonLength)
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("kick")
        .setDescription("Remove a member from the server.")
        .addUserOption((option) =>
          option.setName("user").setDescription("Member to kick").setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName("reason")
            .setDescription("Reason recorded in the case and Discord audit log")
            .setMinLength(2)
            .setMaxLength(maximumReasonLength)
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("ban")
        .setDescription("Ban a member from the server.")
        .addUserOption((option) =>
          option.setName("user").setDescription("Member to ban").setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName("reason")
            .setDescription("Reason recorded in the case and Discord audit log")
            .setMinLength(2)
            .setMaxLength(maximumReasonLength)
            .setRequired(true),
        )
        .addIntegerOption((option) =>
          option
            .setName("delete_days")
            .setDescription("Delete this many days of the member's messages")
            .setMinValue(0)
            .setMaxValue(7),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("unban")
        .setDescription("Remove a ban by Discord user ID.")
        .addStringOption((option) =>
          option
            .setName("user_id")
            .setDescription("Discord ID of the banned user")
            .setMinLength(17)
            .setMaxLength(20)
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName("reason")
            .setDescription("Reason recorded in the case and Discord audit log")
            .setMinLength(2)
            .setMaxLength(maximumReasonLength)
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("purge")
        .setDescription("Bulk-delete recent messages in the current channel.")
        .addIntegerOption((option) =>
          option
            .setName("amount")
            .setDescription("Number of recent messages to delete")
            .setMinValue(1)
            .setMaxValue(100)
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName("reason")
            .setDescription("Reason recorded in the moderation case")
            .setMinLength(2)
            .setMaxLength(maximumReasonLength)
            .setRequired(true),
        )
        .addUserOption((option) =>
          option.setName("user").setDescription("Only purge messages from this user (optional)"),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("case")
        .setDescription("Inspect one moderation case from this server.")
        .addIntegerOption((option) =>
          option.setName("number").setDescription("Case number").setMinValue(1).setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("history")
        .setDescription("Show recent moderation cases for a member.")
        .addUserOption((option) =>
          option
            .setName("user")
            .setDescription("Member whose history to inspect")
            .setRequired(true),
        )
        .addIntegerOption((option) =>
          option
            .setName("limit")
            .setDescription("Number of cases to show")
            .setMinValue(1)
            .setMaxValue(10),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("history-id")
        .setDescription("Show moderation cases for a user ID, including former members.")
        .addStringOption((option) =>
          option
            .setName("user_id")
            .setDescription("Discord user ID")
            .setMinLength(17)
            .setMaxLength(20)
            .setRequired(true),
        )
        .addIntegerOption((option) =>
          option
            .setName("limit")
            .setDescription("Number of cases to show")
            .setMinValue(1)
            .setMaxValue(10),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("recent")
        .setDescription("Show the server's most recent moderation cases.")
        .addIntegerOption((option) =>
          option
            .setName("limit")
            .setDescription("Number of cases to show")
            .setMinValue(1)
            .setMaxValue(10),
        ),
    )
    .toJSON();

export function createModerationActionCommand(
  service: ModerationActionService,
  settings: ModerationSettingsService,
  notifier: DiscordModerationUserNotifier,
): ChatInputCommand {
  return {
    data: moderationActionCommandData,
    guildOnly: true,
    requiredCapability: "moderation",
    requiredMemberPermissions: PermissionFlagsBits.ModerateMembers,

    async execute({ interaction, logger }): Promise<void> {
      if (interaction.guildId === null || interaction.guild === null) {
        throw new Error("Moderation action command executed outside a guild");
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      try {
        await executeSubcommand(
          service,
          settings,
          notifier,
          interaction,
          interaction.guild,
          logger,
        );
      } catch (error) {
        if (error instanceof ModerationCommandRejection) {
          logger.info({ rejectionCode: error.code }, "Moderation command rejected");
          await respondWithPanelEphemerally(interaction, {
            body: error.userMessage,
            title: "Action not allowed",
            tone: "warning",
          });
          return;
        }

        if (error instanceof ModerationActionExecutionError) {
          await respondWithPanelEphemerally(interaction, {
            body: `Discord did not complete the action. Luna recorded it as failed under **case #${error.moderationCase.caseNumber}**. Check the bot's permissions and role position, then try again.`,
            title: "Moderation action failed",
            tone: "danger",
          });
          return;
        }

        throw error;
      }
    },
  };
}

async function executeSubcommand(
  service: ModerationActionService,
  settings: ModerationSettingsService,
  notifier: DiscordModerationUserNotifier,
  interaction: ChatInputCommandInteraction,
  guild: Guild,
  logger: AppLogger,
): Promise<void> {
  const subcommand = interaction.options.getSubcommand(true);

  switch (subcommand) {
    case "warn":
      await handleWarn(service, settings, notifier, interaction, guild, logger);
      return;
    case "timeout":
      await handleTimeout(service, settings, notifier, interaction, guild, logger);
      return;
    case "untimeout":
      await handleUntimeout(service, settings, notifier, interaction, guild, logger);
      return;
    case "kick":
      await handleKick(service, settings, notifier, interaction, guild, logger);
      return;
    case "ban":
      await handleBan(service, settings, notifier, interaction, guild, logger);
      return;
    case "unban":
      await handleUnban(service, interaction, guild);
      return;
    case "purge":
      await handlePurge(service, interaction);
      return;
    case "case":
      await handleCaseLookup(service, interaction);
      return;
    case "history":
      await handleHistory(service, interaction);
      return;
    case "history-id":
      await handleHistoryById(service, interaction);
      return;
    case "recent":
      await handleRecent(service, interaction);
      return;
    default:
      throw new Error(`Unsupported moderation subcommand '${subcommand}'`);
  }
}

async function handleWarn(
  service: ModerationActionService,
  settings: ModerationSettingsService,
  notifier: DiscordModerationUserNotifier,
  interaction: ChatInputCommandInteraction,
  guild: Guild,
  logger: AppLogger,
): Promise<void> {
  const target = await resolveTargetMember(interaction, guild, logger);
  await resolveAndValidateModerator(interaction, guild, target);
  const reason = getReason(interaction);
  const completed = await service.execute(
    createMemberRequest("warn", interaction, target, reason),
    () => Promise.resolve(),
  );
  const notification = await notifyTarget(
    settings,
    notifier,
    guild,
    target,
    completed.moderationCase,
  );
  const warningCount = (await service.listHistory(guild.id, target.id, 100)).filter(
    (moderationCase) => moderationCase.action === "warn" && moderationCase.status === "completed",
  ).length;

  await respondWithActionSuccess(
    interaction,
    completed.moderationCase,
    `The warning was recorded. This member now has **${warningCount}** completed warning case(s).`,
    notification,
  );
}

async function handleTimeout(
  service: ModerationActionService,
  settings: ModerationSettingsService,
  notifier: DiscordModerationUserNotifier,
  interaction: ChatInputCommandInteraction,
  guild: Guild,
  logger: AppLogger,
): Promise<void> {
  const target = await resolveTargetMember(interaction, guild, logger);
  await resolveAndValidateModerator(interaction, guild, target);
  requireBotPermission(interaction, PermissionFlagsBits.ModerateMembers, "time out members");

  if (!target.moderatable) {
    reject(
      "bot-cannot-moderate",
      "Luna cannot time out this member. Check its role position and Moderate Members permission.",
    );
  }

  const durationInput = interaction.options.getString("duration", true);
  const durationSeconds = parseModerationDuration(durationInput);

  if (durationSeconds === undefined) {
    reject(
      "invalid-duration",
      "Enter a duration such as `30m`, `2h`, or `7d`. The maximum timeout is `28d`.",
    );
  }

  const reason = getReason(interaction);
  const completed = await service.execute(
    { ...createMemberRequest("timeout", interaction, target, reason), durationSeconds },
    (moderationCase) => target.timeout(durationSeconds * 1_000, createAuditReason(moderationCase)),
  );
  const notification = await notifyTarget(
    settings,
    notifier,
    guild,
    target,
    completed.moderationCase,
  );

  await respondWithActionSuccess(
    interaction,
    completed.moderationCase,
    `The member was timed out for **${formatDurationSeconds(durationSeconds)}**.`,
    notification,
  );
}

async function handleUntimeout(
  service: ModerationActionService,
  settings: ModerationSettingsService,
  notifier: DiscordModerationUserNotifier,
  interaction: ChatInputCommandInteraction,
  guild: Guild,
  logger: AppLogger,
): Promise<void> {
  const target = await resolveTargetMember(interaction, guild, logger);
  await resolveAndValidateModerator(interaction, guild, target);
  requireBotPermission(interaction, PermissionFlagsBits.ModerateMembers, "remove timeouts");

  if (!target.isCommunicationDisabled()) {
    reject("not-timed-out", "This member does not currently have an active timeout.");
  }

  if (!target.moderatable) {
    reject(
      "bot-cannot-moderate",
      "Luna cannot edit this member's timeout. Check its role position and permissions.",
    );
  }

  const reason = getReason(interaction);
  const completed = await service.execute(
    createMemberRequest("untimeout", interaction, target, reason),
    (moderationCase) => target.timeout(null, createAuditReason(moderationCase)),
  );
  const notification = await notifyTarget(
    settings,
    notifier,
    guild,
    target,
    completed.moderationCase,
  );

  await respondWithActionSuccess(
    interaction,
    completed.moderationCase,
    "The timeout was removed.",
    notification,
  );
}

async function handleKick(
  service: ModerationActionService,
  settings: ModerationSettingsService,
  notifier: DiscordModerationUserNotifier,
  interaction: ChatInputCommandInteraction,
  guild: Guild,
  logger: AppLogger,
): Promise<void> {
  requireModeratorPermission(interaction, PermissionFlagsBits.KickMembers, "kick members");
  const target = await resolveTargetMember(interaction, guild, logger);
  await resolveAndValidateModerator(interaction, guild, target);
  requireBotPermission(interaction, PermissionFlagsBits.KickMembers, "kick members");

  if (!target.kickable) {
    reject(
      "bot-cannot-kick",
      "Luna cannot kick this member. Check its role position and Kick Members permission.",
    );
  }

  const reason = getReason(interaction);
  const completed = await service.execute(
    createMemberRequest("kick", interaction, target, reason),
    (moderationCase) => target.kick(createAuditReason(moderationCase)),
  );
  const notification = await notifyTarget(
    settings,
    notifier,
    guild,
    target,
    completed.moderationCase,
  );

  await respondWithActionSuccess(
    interaction,
    completed.moderationCase,
    "The member was kicked.",
    notification,
  );
}

async function handleBan(
  service: ModerationActionService,
  settings: ModerationSettingsService,
  notifier: DiscordModerationUserNotifier,
  interaction: ChatInputCommandInteraction,
  guild: Guild,
  logger: AppLogger,
): Promise<void> {
  requireModeratorPermission(interaction, PermissionFlagsBits.BanMembers, "ban members");
  const target = await resolveTargetMember(interaction, guild, logger);
  await resolveAndValidateModerator(interaction, guild, target);
  requireBotPermission(interaction, PermissionFlagsBits.BanMembers, "ban members");

  if (!target.bannable) {
    reject(
      "bot-cannot-ban",
      "Luna cannot ban this member. Check its role position and Ban Members permission.",
    );
  }

  const deleteDays = interaction.options.getInteger("delete_days") ?? 0;
  const reason = getReason(interaction);
  const completed = await service.execute(
    createMemberRequest("ban", interaction, target, reason),
    (moderationCase) =>
      target.ban({
        deleteMessageSeconds: deleteDays * 24 * 60 * 60,
        reason: createAuditReason(moderationCase),
      }),
  );
  const deletionSummary =
    deleteDays === 0
      ? "No message history was removed."
      : `${deleteDays} day(s) of messages were removed.`;
  const notification = await notifyTarget(
    settings,
    notifier,
    guild,
    target,
    completed.moderationCase,
  );

  await respondWithActionSuccess(
    interaction,
    completed.moderationCase,
    `The member was banned. ${deletionSummary}`,
    notification,
  );
}

async function handleUnban(
  service: ModerationActionService,
  interaction: ChatInputCommandInteraction,
  guild: Guild,
): Promise<void> {
  requireModeratorPermission(interaction, PermissionFlagsBits.BanMembers, "remove bans");
  requireBotPermission(interaction, PermissionFlagsBits.BanMembers, "remove bans");
  const targetUserId = interaction.options.getString("user_id", true).trim();

  if (!snowflakePattern.test(targetUserId)) {
    reject("invalid-user-id", "Enter a valid Discord user ID containing 17–20 digits.");
  }

  const reason = getReason(interaction);
  const completed = await service.execute(
    {
      action: "unban",
      guildId: interaction.guildId ?? guild.id,
      moderatorUserId: interaction.user.id,
      reason,
      targetUserId,
    },
    (moderationCase) => guild.bans.remove(targetUserId, createAuditReason(moderationCase)),
  );

  await respondWithActionSuccess(interaction, completed.moderationCase, "The user was unbanned.");
}

async function handlePurge(
  service: ModerationActionService,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  requireModeratorPermission(interaction, PermissionFlagsBits.ManageMessages, "purge messages");
  requireBotPermission(interaction, PermissionFlagsBits.ManageMessages, "delete messages");
  const channel = interaction.channel;

  if (channel === null || !channel.isTextBased() || channel.isDMBased()) {
    reject("invalid-channel", "Messages can only be purged from a server text-based channel.");
  }

  const amount = interaction.options.getInteger("amount", true);
  const targetUser = interaction.options.getUser("user");
  const reason = getReason(interaction);
  const recentMessages = await channel.messages.fetch({ limit: 100 });
  const selectedMessages = recentMessages
    .filter(
      (message) => !message.pinned && (targetUser === null || message.author.id === targetUser.id),
    )
    .first(amount);

  if (selectedMessages.length === 0) {
    reject(
      "no-eligible-messages",
      targetUser === null
        ? "No recent unpinned messages are available to purge in this channel."
        : `No recent unpinned messages from ${formatUserId(targetUser.id)} are available to purge in this channel.`,
    );
  }

  const completed = await service.execute(
    {
      action: "purge",
      guildId: interaction.guildId ?? "",
      moderatorUserId: interaction.user.id,
      reason,
      ...(targetUser === null ? {} : { targetUserId: targetUser.id }),
    },
    () => channel.bulkDelete(selectedMessages, true),
  );
  const deletedCount = completed.result.size;
  const availabilityNote =
    selectedMessages.length < amount
      ? ` Only **${selectedMessages.length}** recent unpinned matching message(s) were available.`
      : "";
  const oldMessageNote =
    deletedCount < selectedMessages.length
      ? " Discord skipped selected messages older than 14 days."
      : "";

  await respondWithActionSuccess(
    interaction,
    completed.moderationCase,
    `Deleted **${deletedCount}** unpinned message(s)${targetUser === null ? "" : ` from ${formatUserId(targetUser.id)}`} in this channel.${availabilityNote}${oldMessageNote}`,
  );
}

async function handleCaseLookup(
  service: ModerationActionService,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const caseNumber = interaction.options.getInteger("number", true);
  const moderationCase = await service.findCase(interaction.guildId ?? "", caseNumber);

  if (moderationCase === undefined) {
    reject("case-not-found", `Case #${caseNumber} does not exist in this server.`);
  }

  await respondWithPanelEphemerally(interaction, {
    body: formatCaseDetails(moderationCase),
    footer: "Case reasons are visible only to moderators using this private command.",
    title: `Moderation case #${moderationCase.caseNumber}`,
  });
}

async function handleHistory(
  service: ModerationActionService,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const user = interaction.options.getUser("user", true);
  const limit = interaction.options.getInteger("limit") ?? 5;
  const cases = await service.listHistory(interaction.guildId ?? "", user.id, limit);

  if (cases.length === 0) {
    await respondWithPanelEphemerally(interaction, {
      body: `${formatUserId(user.id)} has no recorded moderation cases in this server.`,
      title: "No moderation history",
      tone: "neutral",
    });
    return;
  }

  await respondWithHistory(interaction, cases, `Moderation history · ${user.username}`);
}

async function handleHistoryById(
  service: ModerationActionService,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const userId = interaction.options.getString("user_id", true).trim();

  if (!snowflakePattern.test(userId)) {
    reject("invalid-user-id", "Enter a valid Discord user ID containing 17–20 digits.");
  }

  const limit = interaction.options.getInteger("limit") ?? 5;
  const cases = await service.listHistory(interaction.guildId ?? "", userId, limit);

  if (cases.length === 0) {
    await respondWithPanelEphemerally(interaction, {
      body: `${formatUserId(userId)} has no recorded moderation cases in this server.`,
      title: "No moderation history",
      tone: "neutral",
    });
    return;
  }

  await respondWithHistory(interaction, cases, `Moderation history · ${userId}`);
}

async function handleRecent(
  service: ModerationActionService,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const limit = interaction.options.getInteger("limit") ?? 5;
  const cases = await service.listRecent(interaction.guildId ?? "", limit);

  if (cases.length === 0) {
    await respondWithPanelEphemerally(interaction, {
      body: "This server has no recorded moderation cases yet.",
      title: "No recent cases",
      tone: "neutral",
    });
    return;
  }

  await respondWithHistory(interaction, cases, "Recent moderation cases");
}

async function resolveTargetMember(
  interaction: ChatInputCommandInteraction,
  guild: Guild,
  logger: AppLogger,
): Promise<GuildMember> {
  const user = interaction.options.getUser("user", true);

  try {
    return await guild.members.fetch(user.id);
  } catch (error) {
    logger.debug({ err: error, targetUserId: user.id }, "Moderation target is not a guild member");
    reject("target-not-member", "That user is not currently a member of this server.");
  }
}

async function resolveAndValidateModerator(
  interaction: ChatInputCommandInteraction,
  guild: Guild,
  target: GuildMember,
): Promise<GuildMember> {
  const moderator = await guild.members.fetch(interaction.user.id);
  const rejection = evaluateModerationMemberTarget(moderator, target, guild.ownerId);

  if (rejection !== undefined) {
    reject(rejection, policyRejectionMessages[rejection]);
  }

  return moderator;
}

function requireBotPermission(
  interaction: ChatInputCommandInteraction,
  permission: bigint,
  actionDescription: string,
): void {
  if (!interaction.appPermissions.has(permission)) {
    reject(
      "missing-bot-permission",
      `Luna does not have permission to ${actionDescription} in this context. Update the bot role or channel permissions.`,
    );
  }
}

function requireModeratorPermission(
  interaction: ChatInputCommandInteraction,
  permission: bigint,
  actionDescription: string,
): void {
  if (interaction.memberPermissions?.has(permission) !== true) {
    reject(
      "missing-moderator-permission",
      `You need the Discord permission to ${actionDescription} before using this action.`,
    );
  }
}

function createMemberRequest(
  action: Exclude<ModerationAction, "automod" | "purge" | "unban">,
  interaction: ChatInputCommandInteraction,
  target: GuildMember,
  reason: string,
) {
  return {
    action,
    guildId: target.guild.id,
    moderatorUserId: interaction.user.id,
    reason,
    targetUserId: target.id,
  } as const;
}

function getReason(interaction: ChatInputCommandInteraction): string {
  const reason = interaction.options
    .getString("reason", true)
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim();

  if (reason.length < 2) {
    reject("invalid-reason", "The reason must contain at least two visible characters.");
  }

  return reason.slice(0, maximumReasonLength);
}

function createAuditReason(moderationCase: ModerationCase): string {
  return `Luna case #${moderationCase.caseNumber} | Moderator ${moderationCase.moderatorUserId} | ${moderationCase.reason}`;
}

async function respondWithActionSuccess(
  interaction: ChatInputCommandInteraction,
  moderationCase: ModerationCase,
  resultSummary: string,
  notification?: ModerationNotificationResult,
): Promise<void> {
  const target =
    moderationCase.targetUserId === null
      ? "Current channel"
      : formatUserId(moderationCase.targetUserId);

  const notificationSummary =
    notification === undefined ? "" : `\n**Member DM:** ${formatNotificationResult(notification)}`;

  await respondWithPanelEphemerally(interaction, {
    body: `${resultSummary}\n\n**Case:** #${moderationCase.caseNumber}\n**Action:** ${actionNames[moderationCase.action]}\n**Target:** ${target}${notificationSummary}\n**Reason:** ${escapeMarkdown(moderationCase.reason)}`,
    footer: "Completed and stored in this server's moderation history.",
    title: "Moderation action completed",
    tone: "success",
  });
}

function formatCaseDetails(moderationCase: ModerationCase): string {
  const status =
    moderationCase.status === "completed"
      ? "✅ Completed"
      : moderationCase.status === "failed"
        ? "❌ Failed"
        : "⏳ Pending";
  const target =
    moderationCase.targetUserId === null
      ? "Current channel"
      : formatUserId(moderationCase.targetUserId);
  const duration =
    moderationCase.durationSeconds === null
      ? ""
      : `\n**Duration:** ${formatMinutes(moderationCase.durationSeconds / 60)}`;
  const timestamp = Math.floor(moderationCase.createdAt.getTime() / 1_000);

  return `**Action:** ${actionNames[moderationCase.action]}\n**Status:** ${status}\n**Target:** ${target}\n**Moderator:** ${formatUserId(moderationCase.moderatorUserId)}${duration}\n**Created:** <t:${timestamp}:F>\n**Reason:** ${escapeMarkdown(moderationCase.reason)}`;
}

function formatHistoryLine(moderationCase: ModerationCase): string {
  const status =
    moderationCase.status === "completed" ? "✅" : moderationCase.status === "failed" ? "❌" : "⏳";
  const timestamp = Math.floor(moderationCase.createdAt.getTime() / 1_000);
  const reason = escapeMarkdown(truncate(moderationCase.reason, 140));
  const target =
    moderationCase.targetUserId === null ? "" : ` · ${formatUserId(moderationCase.targetUserId)}`;

  return `${status} **#${moderationCase.caseNumber} · ${actionNames[moderationCase.action]}**${target} · <t:${timestamp}:R>\n${reason}`;
}

function formatUserId(userId: string): string {
  return `<@${userId}> (\`${userId}\`)`;
}

function formatDurationSeconds(durationSeconds: number): string {
  return formatMinutes(durationSeconds / 60);
}

function formatMinutes(minutes: number): string {
  if (minutes % (24 * 60) === 0) {
    return `${minutes / (24 * 60)} day(s)`;
  }

  if (minutes % 60 === 0) {
    return `${minutes / 60} hour(s)`;
  }

  return `${minutes} minute(s)`;
}

function truncate(value: string, maximumLength: number): string {
  return value.length <= maximumLength ? value : `${value.slice(0, maximumLength - 1)}…`;
}

async function notifyTarget(
  settings: ModerationSettingsService,
  notifier: DiscordModerationUserNotifier,
  guild: Guild,
  target: GuildMember,
  moderationCase: ModerationCase,
): Promise<ModerationNotificationResult> {
  const moderationSettings = await settings.getSettings(guild.id);
  return notifier.notify(
    target.user,
    guild.name,
    moderationCase,
    moderationSettings.dmNotificationsEnabled,
  );
}

function formatNotificationResult(result: ModerationNotificationResult): string {
  switch (result) {
    case "sent":
      return "✅ Delivered";
    case "disabled":
      return "⏸️ Disabled in moderation settings";
    case "unavailable":
      return "⚠️ Could not deliver (the action still succeeded)";
  }
}

async function respondWithHistory(
  interaction: ChatInputCommandInteraction,
  cases: readonly ModerationCase[],
  title: string,
): Promise<void> {
  await respondWithPanelEphemerally(interaction, {
    body: cases.map(formatHistoryLine).join("\n\n"),
    footer: `Showing ${cases.length} most recent case(s). Use /moderate case for full details.`,
    title,
  });
}

export function parseModerationDuration(input: string): number | undefined {
  const match = /^(\d{1,5})([dhm])$/u.exec(input.trim().toLowerCase());

  if (match === null) {
    return undefined;
  }

  const amount = Number(match[1]);
  const unit = match[2];
  const multiplier = unit === "d" ? 86_400 : unit === "h" ? 3_600 : 60;
  const durationSeconds = amount * multiplier;

  return amount > 0 && durationSeconds <= maximumTimeoutSeconds ? durationSeconds : undefined;
}

function reject(code: string, userMessage: string): never {
  throw new ModerationCommandRejection(code, userMessage);
}
