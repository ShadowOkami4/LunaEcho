import { toError, type AppLogger } from "@lunaecho/core";
import type { LunaDatabase } from "@lunaecho/db";
import {
  renderWelcomeTemplate,
  WelcomeCardService,
  WelcomeSettingsService,
  type WelcomeSettings,
} from "@lunaecho/modules";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  type AttachmentBuilder,
  type Client,
  type GuildMember,
  type MessageActionRowComponentBuilder,
  type PartialGuildMember,
} from "discord.js";

import {
  listen,
  type BotModule,
  type ModuleContext,
} from "../../infrastructure/discord/bot-module.js";
import type {
  ComponentInteractionHandler,
  RoutedComponentInteraction,
} from "../../infrastructure/discord/commands/component-interaction-registry.js";
import { respondWithPanelEphemerally } from "../../infrastructure/discord/commands/interaction-responder.js";
import { createPanel } from "../../infrastructure/discord/components/panel.js";
import { WelcomeCardPainter } from "./welcome-card-painter.js";

export const verificationButtonId = "verify:confirm";

const defaultVerificationText =
  "Welcome! Press the button below to confirm you are human and unlock the server.";

function templateValues(member: GuildMember | PartialGuildMember) {
  return {
    memberCount: member.guild.memberCount,
    serverName: member.guild.name,
    userId: member.id,
    username: member.user.username,
  };
}

/** Sends the text, the card, or both; with neither there is nothing to send. */
async function sendToChannel(
  client: Client,
  channelId: string | null,
  template: string | null,
  member: GuildMember | PartialGuildMember,
  card: () => Promise<AttachmentBuilder | undefined>,
): Promise<void> {
  if (channelId === null) {
    return;
  }

  const channel = client.channels.cache.get(channelId);

  if (channel?.isSendable() !== true) {
    return;
  }

  const attachment = await card();

  if (template === null && attachment === undefined) {
    return;
  }

  await channel.send({
    // Only the new member may be pinged; templates can never reach @everyone or roles.
    allowedMentions: { users: [member.id] },
    ...(template === null
      ? {}
      : { content: renderWelcomeTemplate(template, templateValues(member)) }),
    ...(attachment === undefined ? {} : { files: [attachment] }),
  });
}

/** Autoroles wait until a member passed Discord's membership screening. */
async function giveAutoroles(member: GuildMember, settings: WelcomeSettings): Promise<void> {
  if (settings.autoroleIds.length > 0) {
    await member.roles.add([...settings.autoroleIds], "LunaEcho autorole");
  }
}

class VerificationHandler implements ComponentInteractionHandler {
  public readonly customIdPrefix = "verify:";
  public readonly requiredCapability = "onboarding";

  public constructor(
    private readonly settings: WelcomeSettingsService,
    private readonly logger: AppLogger,
  ) {}

  public async handle(interaction: RoutedComponentInteraction): Promise<void> {
    if (!interaction.isButton() || !interaction.inCachedGuild()) {
      return;
    }

    const { verificationRoleId } = await this.settings.get(interaction.guildId);

    if (verificationRoleId === null) {
      await respondWithPanelEphemerally(interaction, {
        body: "Verification is not set up on this server yet.",
        title: "Not available",
        tone: "warning",
      });
      return;
    }

    if (interaction.member.roles.cache.has(verificationRoleId)) {
      await respondWithPanelEphemerally(interaction, {
        body: "You are already verified.",
        title: "All set",
        tone: "success",
      });
      return;
    }

    try {
      await interaction.member.roles.add(verificationRoleId, "LunaEcho verification");
    } catch (error) {
      this.logger.warn(
        { err: toError(error), guildId: interaction.guildId },
        "Could not give the verification role",
      );
      await respondWithPanelEphemerally(interaction, {
        body: "LunaEcho could not give you the role. Please tell the server team: LunaEcho's role must be above the verification role.",
        title: "Verification failed",
        tone: "danger",
      });
      return;
    }

    await respondWithPanelEphemerally(interaction, {
      body: `You now have <@&${verificationRoleId}>. Have fun!`,
      title: "Verified",
      tone: "success",
    });
  }
}

export function createWelcomeModule(context: ModuleContext, database: LunaDatabase): BotModule {
  const logger = context.logger.child({ component: "welcome" });
  const settings = new WelcomeSettingsService(database);
  const painter = new WelcomeCardPainter(new WelcomeCardService(database), logger);
  const runs = (guildId: string) => context.moduleRuns(guildId, "onboarding");

  return {
    components: [new VerificationHandler(settings, logger)],
    invalidate: (guildId) => {
      settings.invalidate(guildId);
      painter.invalidate(guildId);
    },
    listeners: [
      listen("guildMemberAdd", "welcome.join", async (member) => {
        if (!(await runs(member.guild.id))) {
          return;
        }

        const current = await settings.get(member.guild.id);
        await sendToChannel(
          context.client,
          current.welcomeChannelId,
          current.welcomeMessage,
          member,
          () => painter.paint(member, "welcome"),
        );

        if (member.user.bot) {
          return;
        }

        if (current.directMessage !== null) {
          // Many members block direct messages from servers; that is not an error.
          await member
            .send({
              allowedMentions: { parse: [] },
              content: renderWelcomeTemplate(current.directMessage, templateValues(member)),
            })
            .catch(() => undefined);
        }

        if (!member.pending) {
          await giveAutoroles(member, current);
        }
      }),
      listen("guildMemberUpdate", "welcome.screening-passed", async (oldMember, newMember) => {
        if (
          oldMember.pending === true &&
          !newMember.pending &&
          !newMember.user.bot &&
          (await runs(newMember.guild.id))
        ) {
          await giveAutoroles(newMember, await settings.get(newMember.guild.id));
        }
      }),
      listen("guildMemberRemove", "welcome.leave", async (member) => {
        if (await runs(member.guild.id)) {
          const current = await settings.get(member.guild.id);
          await sendToChannel(
            context.client,
            current.goodbyeChannelId,
            current.goodbyeMessage,
            member,
            () => painter.paint(member, "goodbye"),
          );
        }
      }),
    ],
    name: "onboarding",
    tasks: {
      "post-verification-panel": async (task) => {
        settings.invalidate(task.guildId);
        const current = await settings.get(task.guildId);

        if (current.verificationChannelId === null) {
          return;
        }

        const channel = context.client.channels.cache.get(current.verificationChannelId);

        if (channel?.isSendable() !== true) {
          logger.warn({ guildId: task.guildId }, "Verification channel is unavailable");
          return;
        }

        if (current.verificationMessageId !== null && "messages" in channel) {
          // The old panel may already be gone; posting the new one matters more.
          await channel.messages.delete(current.verificationMessageId).catch(() => undefined);
        }

        const message = await channel.send({
          allowedMentions: { parse: [] },
          components: [
            createPanel({
              body: current.verificationText ?? defaultVerificationText,
              rows: [
                new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
                  new ButtonBuilder()
                    .setCustomId(verificationButtonId)
                    .setEmoji("✅")
                    .setLabel("Verify")
                    .setStyle(ButtonStyle.Success),
                ),
              ],
              title: "Verification",
              tone: "success",
            }),
          ],
          flags: MessageFlags.IsComponentsV2,
        });
        await settings.setVerificationMessage(task.guildId, message.id);
      },
    },
  };
}
