import { moduleCatalog } from "@lunaecho/core";
import {
  ChannelType,
  InteractionContextType,
  SlashCommandBuilder,
  version as discordJsVersion,
  type ChatInputCommandInteraction,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord.js";

import type { ChatInputCommand } from "../../infrastructure/discord/commands/chat-input-command.js";
import { respondWithPanelEphemerally } from "../../infrastructure/discord/commands/interaction-responder.js";
import { formatDuration } from "./format-duration.js";

export const infoCommandData: RESTPostAPIChatInputApplicationCommandsJSONBody =
  new SlashCommandBuilder()
    .setName("info")
    .setDescription("Show information about this server, a member, or LunaEcho.")
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((subcommand) =>
      subcommand.setName("server").setDescription("Show information about this server."),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("user")
        .setDescription("Show information about a member.")
        .addUserOption((option) => option.setName("member").setDescription("Defaults to you.")),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("bot").setDescription("Show LunaEcho's status and gateway latency."),
    )
    .toJSON();

function timestamp(date: Date | null): string {
  return date === null ? "unknown" : `<t:${Math.floor(date.getTime() / 1_000)}:R>`;
}

async function showServer(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
  const guild = interaction.guild;
  const channels = guild.channels.cache;
  const count = (type: ChannelType): number =>
    channels.filter((channel) => channel.type === type).size;

  await respondWithPanelEphemerally(interaction, {
    body: [
      `**Owner:** <@${guild.ownerId}>`,
      `**Created:** ${timestamp(guild.createdAt)}`,
      `**Members:** ${guild.memberCount.toLocaleString("en-US")}`,
      `**Channels:** ${count(ChannelType.GuildText)} text · ${count(ChannelType.GuildVoice)} voice · ${count(ChannelType.GuildCategory)} categories`,
      `**Roles:** ${guild.roles.cache.size - 1}`,
      `**Boosts:** ${guild.premiumSubscriptionCount ?? 0} (tier ${guild.premiumTier})`,
    ].join("\n"),
    footer: `Server id ${guild.id}`,
    title: guild.name,
  });
}

async function showUser(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
  const user = interaction.options.getUser("member") ?? interaction.user;
  // The member cache is deliberately small, so the member is fetched when not cached.
  const member = await interaction.guild.members.fetch(user.id).catch(() => null);
  const roles =
    member?.roles.cache
      .filter((role) => role.id !== interaction.guildId)
      .sort((left, right) => right.position - left.position)
      .map((role) => `<@&${role.id}>`) ?? [];

  await respondWithPanelEphemerally(interaction, {
    body: [
      `**Member:** <@${user.id}>${user.bot ? " · bot" : ""}`,
      `**Account created:** ${timestamp(user.createdAt)}`,
      `**Joined this server:** ${member === null ? "not a member" : timestamp(member.joinedAt)}`,
      `**Roles:** ${roles.length === 0 ? "none" : roles.slice(0, 20).join(" ")}${roles.length > 20 ? ` +${roles.length - 20}` : ""}`,
    ].join("\n"),
    footer: `User id ${user.id}`,
    title: member?.displayName ?? user.username,
  });
}

async function showBot(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
  const latency = Math.max(0, Math.round(interaction.client.ws.ping));

  await respondWithPanelEphemerally(interaction, {
    body: [
      "**Status:** ✅ Operational",
      `**Gateway latency:** \`${latency} ms\``,
      `**Uptime:** \`${formatDuration(process.uptime())}\``,
      `**Servers:** ${interaction.client.guilds.cache.size.toLocaleString("en-US")}`,
      `**Modules:** ${moduleCatalog.length}, switched on per server in the dashboard`,
    ].join("\n"),
    footer: `Node.js ${process.version} · discord.js ${discordJsVersion}`,
    title: "LunaEcho",
    tone: "success",
  });
}

export const infoCommand: ChatInputCommand = {
  data: infoCommandData,
  guildOnly: true,

  async execute({ interaction }): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Info command executed outside a cached guild");
    }

    switch (interaction.options.getSubcommand(true)) {
      case "server":
        await showServer(interaction);
        return;
      case "user":
        await showUser(interaction);
        return;
      default:
        await showBot(interaction);
    }
  },
};
