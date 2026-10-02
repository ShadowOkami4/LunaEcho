import { toError } from "@lunaecho/core";
import type { LunaDatabase } from "@lunaecho/db";
import { computeRoleChanges, RoleMenuService, type RoleMenu } from "@lunaecho/modules";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  StringSelectMenuBuilder,
  type Guild,
  type MessageActionRowComponentBuilder,
} from "discord.js";

import type { BotModule, ModuleContext } from "../../infrastructure/discord/bot-module.js";
import type {
  ComponentInteractionHandler,
  RoutedComponentInteraction,
} from "../../infrastructure/discord/commands/component-interaction-registry.js";
import { respondWithPanelEphemerally } from "../../infrastructure/discord/commands/interaction-responder.js";
import { createPanel } from "../../infrastructure/discord/components/panel.js";

export const roleMenuPrefix = "roles:";

/** Buttons go five to a row; a select menu fills one row. */
export function createRoleMenuRows(
  menu: RoleMenu,
): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  if (menu.style === "select") {
    const select = new StringSelectMenuBuilder()
      .setCustomId(`${roleMenuPrefix}${menu.id}`)
      .setPlaceholder(menu.mode === "single" ? "Choose a role" : "Choose your roles")
      // Zero lets members remove every role of the menu again.
      .setMinValues(0)
      .setMaxValues(menu.mode === "single" ? 1 : menu.options.length)
      .addOptions(
        menu.options.map((option) => ({
          label: option.label,
          value: option.roleId,
          ...(option.description === null ? {} : { description: option.description }),
          ...(option.emoji === null ? {} : { emoji: option.emoji }),
        })),
      );
    return [new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(select)];
  }

  const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];

  for (let start = 0; start < menu.options.length; start += 5) {
    rows.push(
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        menu.options.slice(start, start + 5).map((option) => {
          const button = new ButtonBuilder()
            .setCustomId(`${roleMenuPrefix}${menu.id}:${option.roleId}`)
            .setLabel(option.label)
            .setStyle(ButtonStyle.Secondary);
          return option.emoji === null ? button : button.setEmoji(option.emoji);
        }),
      ),
    );
  }

  return rows;
}

/** Roles above LunaEcho's own, and roles owned by integrations, cannot be handed out. */
function unassignable(guild: Guild, roleIds: readonly string[]): string[] {
  const highest = guild.members.me?.roles.highest.position ?? 0;
  return roleIds.filter((roleId) => {
    const role = guild.roles.cache.get(roleId);
    return role === undefined || role.managed || role.position >= highest;
  });
}

class RoleMenuHandler implements ComponentInteractionHandler {
  public readonly customIdPrefix = roleMenuPrefix;
  public readonly requiredCapability = "roles";

  public constructor(private readonly menus: RoleMenuService) {}

  public async handle(interaction: RoutedComponentInteraction): Promise<void> {
    if (!interaction.inCachedGuild() || interaction.isModalSubmit()) {
      return;
    }

    const [menuId = "", clickedRoleId] = interaction.customId
      .slice(roleMenuPrefix.length)
      .split(":");
    const menu = await this.menus.get(interaction.guildId, menuId);

    if (menu === undefined) {
      await respondWithPanelEphemerally(interaction, {
        body: "This role menu was removed.",
        title: "Not available",
        tone: "warning",
      });
      return;
    }

    const picked = interaction.isStringSelectMenu()
      ? interaction.values
      : clickedRoleId === undefined
        ? []
        : [clickedRoleId];
    const changes = computeRoleChanges(
      menu,
      new Set(interaction.member.roles.cache.keys()),
      picked,
    );
    const blocked = unassignable(interaction.guild, [...changes.add, ...changes.remove]);

    if (blocked.length > 0) {
      await respondWithPanelEphemerally(interaction, {
        body: `LunaEcho cannot manage ${blocked.map((roleId) => `<@&${roleId}>`).join(", ")}. Its own role must be above these roles.`,
        title: "Role unavailable",
        tone: "danger",
      });
      return;
    }

    if (changes.remove.length > 0) {
      await interaction.member.roles.remove([...changes.remove], "LunaEcho role menu");
    }

    if (changes.add.length > 0) {
      await interaction.member.roles.add([...changes.add], "LunaEcho role menu");
    }

    const lines = [
      ...changes.add.map((roleId) => `➕ <@&${roleId}>`),
      ...changes.remove.map((roleId) => `➖ <@&${roleId}>`),
    ];
    await respondWithPanelEphemerally(interaction, {
      body: lines.length === 0 ? "Nothing changed." : lines.join("\n"),
      title: "Your roles",
      tone: "success",
    });
  }
}

export function createRolesModule(context: ModuleContext, database: LunaDatabase): BotModule {
  const logger = context.logger.child({ component: "roles" });
  const menus = new RoleMenuService(database);

  const sendableChannel = (channelId: string) => {
    const channel = context.client.channels.cache.get(channelId);
    return channel?.isSendable() === true && "messages" in channel ? channel : undefined;
  };

  return {
    components: [new RoleMenuHandler(menus)],
    invalidate: (guildId) => {
      menus.invalidate(guildId);
    },
    name: "roles",
    tasks: {
      "post-role-menu": async (task) => {
        menus.invalidate(task.guildId);
        const menuId = typeof task.payload["menuId"] === "string" ? task.payload["menuId"] : "";
        const menu = await menus.get(task.guildId, menuId);

        if (menu === undefined) {
          return;
        }

        const channel = sendableChannel(menu.channelId);

        if (channel === undefined) {
          logger.warn({ guildId: task.guildId, menuId }, "Role menu channel is unavailable");
          return;
        }

        if (menu.messageId !== null) {
          // When the menu moved channels, the dashboard queues "remove-role-menu" for the old one.
          await channel.messages.delete(menu.messageId).catch(() => undefined);
        }

        const message = await channel.send({
          allowedMentions: { parse: [] },
          components: [
            createPanel({
              body: menu.description.length === 0 ? "Choose your roles below." : menu.description,
              rows: createRoleMenuRows(menu),
              title: menu.title,
            }),
          ],
          flags: MessageFlags.IsComponentsV2,
        });
        await menus.setMessage(task.guildId, menu.id, message.id);
      },
      "remove-role-menu": async (task) => {
        const { channelId, messageId } = task.payload;

        if (typeof channelId === "string" && typeof messageId === "string") {
          await sendableChannel(channelId)
            ?.messages.delete(messageId)
            .catch((error: unknown) => {
              logger.debug({ err: toError(error) }, "Role menu message was already gone");
            });
        }
      },
    },
  };
}
