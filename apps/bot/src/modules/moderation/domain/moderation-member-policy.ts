import type { GuildMember } from "discord.js";

export type ModerationMemberPolicyRejection =
  "bot-target" | "guild-owner" | "higher-or-equal-role" | "self-target";

export function evaluateModerationMemberTarget(
  moderator: GuildMember,
  target: GuildMember,
  guildOwnerId: string,
): ModerationMemberPolicyRejection | undefined {
  if (target.id === moderator.id) {
    return "self-target";
  }

  if (target.id === guildOwnerId) {
    return "guild-owner";
  }

  if (target.user.bot) {
    return "bot-target";
  }

  if (
    moderator.id !== guildOwnerId &&
    moderator.roles.highest.comparePositionTo(target.roles.highest) <= 0
  ) {
    return "higher-or-equal-role";
  }

  return undefined;
}
