import type { LunaDatabase } from "@lunaecho/db";
import { LogSettingsService, type ModerationActionService } from "@lunaecho/modules";
import type { GuildMember, PartialGuildMember } from "discord.js";

import {
  listen,
  type BotModule,
  type ModuleContext,
} from "../../infrastructure/discord/bot-module.js";
import { LogMessageCache } from "./log-message-cache.js";
import { LogSender, quote } from "./log-sender.js";

function timestamp(date: Date | null): string {
  return date === null ? "unknown" : `<t:${Math.floor(date.getTime() / 1_000)}:R>`;
}

function memberName(member: GuildMember | PartialGuildMember): string {
  return `<@${member.id}> (${member.user.username})`;
}

export function createLogsModule(
  context: ModuleContext,
  database: LunaDatabase,
  moderationActions: ModerationActionService,
  /** Channels LunaEcho manages itself, such as voice rooms, are left out of server logs. */
  isManagedChannel: (channelId: string) => boolean = () => false,
): BotModule {
  const logger = context.logger.child({ component: "logs" });
  const settings = new LogSettingsService(database);
  const sender = new LogSender(
    context.client,
    settings,
    (guildId) => context.moduleRuns(guildId, "logs"),
    logger,
  );
  const cache = new LogMessageCache();

  moderationActions.subscribe((moderationCase) => {
    void sender.send(moderationCase.guildId, "moderation", {
      body: [
        `**Action:** ${moderationCase.action}${moderationCase.durationSeconds === null ? "" : ` for ${Math.round(moderationCase.durationSeconds / 60)} min`}`,
        `**Member:** ${moderationCase.targetUserId === null ? "none" : `<@${moderationCase.targetUserId}>`}`,
        `**By:** <@${moderationCase.moderatorUserId}>`,
        `**Reason:** ${moderationCase.reason}`,
        ...(moderationCase.status === "failed"
          ? ["**Result:** ❌ Discord refused the action"]
          : []),
      ].join("\n"),
      footer: `Case #${moderationCase.caseNumber}`,
      title: `Case #${moderationCase.caseNumber} · ${moderationCase.action}`,
      tone: moderationCase.status === "failed" ? "danger" : "warning",
    });
  });

  return {
    invalidate: (guildId) => {
      settings.invalidate(guildId);
    },
    listeners: [
      listen("messageDelete", "logs.message-delete", async (message) => {
        if (message.guildId === null || message.author?.bot === true) {
          return;
        }

        const cached = cache.forget(message.id);

        if (
          !(await sender.isEnabled(message.guildId, "message")) ||
          (await sender.isIgnored(message.guildId, message.channelId))
        ) {
          return;
        }

        const content = message.content ?? cached?.content;
        const authorId = message.author?.id ?? cached?.authorId;
        await sender.send(message.guildId, "message", {
          body: [
            `**Channel:** <#${message.channelId}>`,
            `**Author:** ${authorId === undefined ? "unknown" : `<@${authorId}>`}`,
            content === undefined
              ? "-# The text is unknown: the message was sent before LunaEcho started watching."
              : quote(content),
          ].join("\n"),
          footer: `Message ${message.id}`,
          title: "Message deleted",
          tone: "danger",
        });
      }),
      listen("messageDeleteBulk", "logs.message-bulk-delete", async (messages, channel) => {
        if (channel.isDMBased() || !(await sender.isEnabled(channel.guildId, "message"))) {
          return;
        }

        for (const id of messages.keys()) {
          cache.forget(id);
        }

        await sender.send(channel.guildId, "message", {
          body: `**${messages.size} messages** were deleted at once in <#${channel.id}>.`,
          title: "Messages purged",
          tone: "danger",
        });
      }),
      listen("messageUpdate", "logs.message-edit", async (oldMessage, newMessage) => {
        if (newMessage.guildId === null || newMessage.author.bot) {
          return;
        }

        const before = oldMessage.content ?? cache.get(newMessage.id)?.content;
        const after = newMessage.content;

        // Discord also sends updates when link previews load; only text changes are logged.
        if (before === after) {
          return;
        }

        const known = cache.get(newMessage.id);

        if (known !== undefined) {
          cache.remember(newMessage.id, { ...known, content: after });
        }

        if (
          !(await sender.isEnabled(newMessage.guildId, "message")) ||
          (await sender.isIgnored(newMessage.guildId, newMessage.channelId))
        ) {
          return;
        }

        await sender.send(newMessage.guildId, "message", {
          body: [
            `**Channel:** <#${newMessage.channelId}> · [jump to message](${newMessage.url})`,
            `**Author:** <@${newMessage.author.id}>`,
            "**Before**",
            before === undefined ? "-# unknown" : quote(before, 450),
            "**After**",
            quote(after, 450),
          ].join("\n"),
          footer: `Message ${newMessage.id}`,
          title: "Message edited",
          tone: "info",
        });
      }),
      listen("guildMemberAdd", "logs.member-join", async (member) => {
        await sender.send(member.guild.id, "member", {
          body: [
            `**Member:** ${memberName(member)}`,
            `**Account created:** ${timestamp(member.user.createdAt)}`,
            `**Members now:** ${member.guild.memberCount.toLocaleString("en-US")}`,
          ].join("\n"),
          footer: `User ${member.id}`,
          title: "Member joined",
          tone: "success",
        });
      }),
      listen("guildMemberRemove", "logs.member-leave", async (member) => {
        await sender.send(member.guild.id, "member", {
          body: [
            `**Member:** ${memberName(member)}`,
            `**Joined:** ${timestamp(member.joinedAt)}`,
            `**Members now:** ${member.guild.memberCount.toLocaleString("en-US")}`,
          ].join("\n"),
          footer: `User ${member.id}`,
          title: "Member left",
          tone: "neutral",
        });
      }),
      listen("guildMemberUpdate", "logs.member-update", async (oldMember, newMember) => {
        const changes: string[] = [];

        if (!oldMember.partial && oldMember.nickname !== newMember.nickname) {
          changes.push(
            `**Nickname:** ${oldMember.nickname ?? "none"} → ${newMember.nickname ?? "none"}`,
          );
        }

        // Role changes are only visible when the old member was cached, which is often not the case.
        if (!oldMember.partial) {
          const added = newMember.roles.cache.filter((role) => !oldMember.roles.cache.has(role.id));
          const removed = oldMember.roles.cache.filter(
            (role) => !newMember.roles.cache.has(role.id),
          );

          if (added.size > 0) {
            changes.push(`**Roles added:** ${added.map((role) => `<@&${role.id}>`).join(" ")}`);
          }

          if (removed.size > 0) {
            changes.push(`**Roles removed:** ${removed.map((role) => `<@&${role.id}>`).join(" ")}`);
          }
        }

        if (changes.length > 0) {
          await sender.send(newMember.guild.id, "member", {
            body: [`**Member:** ${memberName(newMember)}`, ...changes].join("\n"),
            footer: `User ${newMember.id}`,
            title: "Member updated",
            tone: "info",
          });
        }
      }),
      listen("guildBanAdd", "logs.ban-add", async (ban) => {
        await sender.send(ban.guild.id, "member", {
          body: `**User:** <@${ban.user.id}> (${ban.user.username})${ban.reason === null || ban.reason === undefined ? "" : `\n**Reason:** ${ban.reason}`}`,
          footer: `User ${ban.user.id}`,
          title: "Member banned",
          tone: "danger",
        });
      }),
      listen("guildBanRemove", "logs.ban-remove", async (ban) => {
        await sender.send(ban.guild.id, "member", {
          body: `**User:** <@${ban.user.id}> (${ban.user.username})`,
          footer: `User ${ban.user.id}`,
          title: "Ban lifted",
          tone: "success",
        });
      }),
      listen("channelCreate", "logs.channel-create", async (channel) => {
        if (isManagedChannel(channel.id)) {
          return;
        }

        await sender.send(channel.guildId, "server", {
          body: `<#${channel.id}> (${channel.name})`,
          footer: `Channel ${channel.id}`,
          title: "Channel created",
          tone: "success",
        });
      }),
      listen("channelDelete", "logs.channel-delete", async (channel) => {
        if (!channel.isDMBased() && !isManagedChannel(channel.id)) {
          await sender.send(channel.guildId, "server", {
            body: `**${channel.name}**`,
            footer: `Channel ${channel.id}`,
            title: "Channel deleted",
            tone: "danger",
          });
        }
      }),
      listen("channelUpdate", "logs.channel-update", async (oldChannel, newChannel) => {
        if (
          newChannel.isDMBased() ||
          oldChannel.isDMBased() ||
          oldChannel.name === newChannel.name
        ) {
          return;
        }

        await sender.send(newChannel.guildId, "server", {
          body: `<#${newChannel.id}>: **${oldChannel.name}** → **${newChannel.name}**`,
          footer: `Channel ${newChannel.id}`,
          title: "Channel renamed",
          tone: "info",
        });
      }),
      listen("roleCreate", "logs.role-create", async (role) => {
        await sender.send(role.guild.id, "server", {
          body: `<@&${role.id}> (${role.name})`,
          footer: `Role ${role.id}`,
          title: "Role created",
          tone: "success",
        });
      }),
      listen("roleDelete", "logs.role-delete", async (role) => {
        await sender.send(role.guild.id, "server", {
          body: `**${role.name}**`,
          footer: `Role ${role.id}`,
          title: "Role deleted",
          tone: "danger",
        });
      }),
      listen("roleUpdate", "logs.role-update", async (oldRole, newRole) => {
        const changes = [
          ...(oldRole.name === newRole.name ? [] : [`**Name:** ${oldRole.name} → ${newRole.name}`]),
          ...(oldRole.permissions.bitfield === newRole.permissions.bitfield
            ? []
            : ["**Permissions changed**"]),
        ];

        if (changes.length > 0) {
          await sender.send(newRole.guild.id, "server", {
            body: [`<@&${newRole.id}>`, ...changes].join("\n"),
            footer: `Role ${newRole.id}`,
            title: "Role updated",
            tone: "info",
          });
        }
      }),
      listen("voiceStateUpdate", "logs.voice", async (oldState, newState) => {
        if (oldState.channelId === newState.channelId || newState.member?.user.bot === true) {
          return;
        }

        const guildId = newState.guild.id;

        if (
          !(await sender.isEnabled(guildId, "voice")) ||
          (await sender.isIgnored(guildId, newState.channelId ?? oldState.channelId))
        ) {
          return;
        }

        const [title, body] =
          oldState.channelId === null
            ? ["Joined voice", `<@${newState.id}> joined <#${newState.channelId ?? ""}>`]
            : newState.channelId === null
              ? ["Left voice", `<@${newState.id}> left <#${oldState.channelId}>`]
              : [
                  "Moved voice",
                  `<@${newState.id}> moved from <#${oldState.channelId}> to <#${newState.channelId}>`,
                ];

        await sender.send(guildId, "voice", {
          body,
          footer: `User ${newState.id}`,
          title,
          tone: "neutral",
        });
      }),
    ],
    messageHandlers: [
      {
        // Remembers messages for deletion logs. Runs after AutoMod, so removed spam is skipped.
        handle: async (message) => {
          if (
            message.inGuild() &&
            !message.author.bot &&
            (await sender.isEnabled(message.guildId, "message")) &&
            !(await sender.isIgnored(message.guildId, message.channelId))
          ) {
            cache.remember(message.id, {
              attachments: message.attachments.size,
              authorId: message.author.id,
              channelId: message.channelId,
              content: message.content,
              createdAt: message.createdAt,
              guildId: message.guildId,
            });
          }

          return "continue";
        },
      },
    ],
    name: "logs",
  };
}
