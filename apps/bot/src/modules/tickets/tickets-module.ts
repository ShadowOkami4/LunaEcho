import { toError, type AppLogger } from "@lunaecho/core";
import type { LunaDatabase } from "@lunaecho/db";
import { maximumTicketTopicLength, TicketService, type Ticket } from "@lunaecho/modules";
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  ThreadAutoArchiveDuration,
  type Client,
  type GuildMember,
  type Message,
  type MessageActionRowComponentBuilder,
  type ThreadChannel,
} from "discord.js";

import type { BotModule, ModuleContext } from "../../infrastructure/discord/bot-module.js";
import type {
  ComponentInteractionHandler,
  RoutedComponentInteraction,
} from "../../infrastructure/discord/commands/component-interaction-registry.js";
import { respondWithPanelEphemerally } from "../../infrastructure/discord/commands/interaction-responder.js";
import { createPanel } from "../../infrastructure/discord/components/panel.js";
import { formatTranscript, type TranscriptMessage } from "./ticket-transcript.js";

export const ticketIds = {
  claim: "ticket:claim",
  close: "ticket:close",
  closeForm: "ticket:close-form",
  open: "ticket:open",
  openForm: "ticket:open-form",
} as const;

const topicField = "topic";
const reasonField = "reason";
/** Long tickets are cut here; the transcript says so. */
const maximumTranscriptMessages = 1_000;

function row(...buttons: ButtonBuilder[]): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(buttons);
}

function ticketControls(claimedBy: string | null) {
  return row(
    new ButtonBuilder()
      .setCustomId(ticketIds.claim)
      .setEmoji("🙋")
      .setLabel(claimedBy === null ? "Claim" : "Claimed")
      .setDisabled(claimedBy !== null)
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(ticketIds.close)
      .setEmoji("🔒")
      .setLabel("Close")
      .setStyle(ButtonStyle.Danger),
  );
}

async function collectTranscript(thread: ThreadChannel): Promise<TranscriptMessage[]> {
  const collected: Message[] = [];
  let before: string | undefined;

  while (collected.length < maximumTranscriptMessages) {
    const page = await thread.messages.fetch({
      limit: 100,
      ...(before === undefined ? {} : { before }),
    });

    if (page.size === 0) {
      break;
    }

    collected.push(...page.values());
    before = page.last()?.id;
  }

  return collected.reverse().map((message) => ({
    attachments: message.attachments.map((attachment) => attachment.url),
    authorName: message.author.username,
    bot: message.author.bot,
    content: message.content,
    createdAt: message.createdAt,
  }));
}

class TicketHandler implements ComponentInteractionHandler {
  public readonly customIdPrefix = "ticket:";
  public readonly requiredCapability = "tickets";

  public constructor(
    private readonly tickets: TicketService,
    private readonly client: Client,
    private readonly logger: AppLogger,
  ) {}

  public async handle(interaction: RoutedComponentInteraction): Promise<void> {
    if (!interaction.inCachedGuild()) {
      return;
    }

    switch (interaction.customId) {
      case ticketIds.open:
        if (interaction.isModalSubmit()) {
          return;
        }

        await interaction.showModal(
          new ModalBuilder()
            .setCustomId(ticketIds.openForm)
            .setTitle("Open a ticket")
            .addLabelComponents(
              new LabelBuilder()
                .setLabel("How can the team help?")
                .setTextInputComponent(
                  new TextInputBuilder()
                    .setCustomId(topicField)
                    .setStyle(TextInputStyle.Paragraph)
                    .setMaxLength(maximumTicketTopicLength)
                    .setRequired(true),
                ),
            ),
        );
        return;
      case ticketIds.openForm:
        if (interaction.isModalSubmit()) {
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          await this.open(
            interaction.member,
            interaction.fields.getTextInputValue(topicField),
            (options) => respondWithPanelEphemerally(interaction, options),
          );
        }
        return;
      default:
        break;
    }

    const thread = interaction.channel;
    const ticket =
      thread?.isThread() === true ? await this.tickets.findByThread(thread.id) : undefined;

    if (thread?.isThread() !== true || ticket === undefined || ticket.status === "closed") {
      await respondWithPanelEphemerally(interaction, {
        body: "This ticket is already closed.",
        title: "Ticket closed",
        tone: "neutral",
      });
      return;
    }

    const isStaff = await this.isStaff(interaction.member, thread);

    if (interaction.customId === ticketIds.claim) {
      if (!isStaff) {
        await respondWithPanelEphemerally(interaction, {
          body: "Only the server team can claim tickets.",
          title: "Not allowed",
          tone: "danger",
        });
        return;
      }

      if (!(await this.tickets.claim(ticket.id, interaction.user.id))) {
        await respondWithPanelEphemerally(interaction, {
          body: "Someone else claimed this ticket first.",
          title: "Already claimed",
          tone: "warning",
        });
        return;
      }

      if (interaction.isButton()) {
        await interaction.update({ components: this.openingPanel(ticket, interaction.user.id) });
      }

      await thread.send({
        allowedMentions: { parse: [] },
        components: [
          createPanel({
            body: `<@${interaction.user.id}> takes care of this ticket.`,
            title: "Claimed",
            tone: "info",
          }),
        ],
        flags: MessageFlags.IsComponentsV2,
      });
      return;
    }

    if (!isStaff && interaction.user.id !== ticket.openerId) {
      await respondWithPanelEphemerally(interaction, {
        body: "Only the opener and the server team can close this ticket.",
        title: "Not allowed",
        tone: "danger",
      });
      return;
    }

    if (interaction.customId === ticketIds.close && !interaction.isModalSubmit()) {
      await interaction.showModal(
        new ModalBuilder()
          .setCustomId(ticketIds.closeForm)
          .setTitle(`Close ticket #${ticket.number}`)
          .addLabelComponents(
            new LabelBuilder()
              .setLabel("Reason (optional)")
              .setTextInputComponent(
                new TextInputBuilder()
                  .setCustomId(reasonField)
                  .setStyle(TextInputStyle.Short)
                  .setMaxLength(200)
                  .setRequired(false),
              ),
          ),
      );
      return;
    }

    if (interaction.customId === ticketIds.closeForm && interaction.isModalSubmit()) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const closed = await this.tickets.close(
        ticket.id,
        interaction.user.id,
        interaction.fields.getTextInputValue(reasonField),
      );

      if (closed === undefined) {
        await respondWithPanelEphemerally(interaction, {
          body: "This ticket was closed already.",
          title: "Ticket closed",
          tone: "neutral",
        });
        return;
      }

      await respondWithPanelEphemerally(interaction, {
        body: "The ticket is closed and archived.",
        title: "Closed",
        tone: "success",
      });
      await this.finish(closed, thread);
    }
  }

  private openingPanel(ticket: Ticket, claimedBy: string | null) {
    return [
      createPanel({
        body: [
          `<@${ticket.openerId}> opened this ticket.`,
          "",
          `**Topic**\n${ticket.topic}`,
          "",
          "The team will answer here. Only you, the team, and people added to this thread can see it.",
        ].join("\n"),
        footer: claimedBy === null ? "Not claimed yet" : `Claimed by <@${claimedBy}>`,
        rows: [ticketControls(claimedBy)],
        title: `Ticket #${ticket.number}`,
      }),
    ];
  }

  private async isStaff(member: GuildMember, thread: ThreadChannel): Promise<boolean> {
    const settings = await this.tickets.getSettings(member.guild.id);
    return (
      settings.staffRoleIds.some((roleId) => member.roles.cache.has(roleId)) ||
      thread.permissionsFor(member).has(PermissionFlagsBits.ManageThreads)
    );
  }

  private async open(
    member: GuildMember,
    topic: string,
    respond: (options: Parameters<typeof respondWithPanelEphemerally>[1]) => Promise<void>,
  ): Promise<void> {
    const result = await this.tickets.open({
      guildId: member.guild.id,
      openerId: member.id,
      topic,
    });

    if (result.kind === "too-many") {
      await respond({
        body: `You already have an open ticket: ${result.open.map((ticket) => (ticket.threadId === null ? `#${ticket.number}` : `<#${ticket.threadId}>`)).join(", ")}`,
        title: "Ticket already open",
        tone: "warning",
      });
      return;
    }

    if (result.kind !== "opened") {
      await respond({
        body:
          result.kind === "invalid-topic"
            ? "Please describe what you need."
            : "Tickets are not set up on this server.",
        title: "Could not open a ticket",
        tone: "danger",
      });
      return;
    }

    const settings = await this.tickets.getSettings(member.guild.id);
    const parent =
      settings.panelChannelId === null
        ? undefined
        : this.client.channels.cache.get(settings.panelChannelId);
    let thread: ThreadChannel;

    try {
      if (parent?.type !== ChannelType.GuildText) {
        throw new Error("The ticket channel is not a text channel");
      }

      thread = await parent.threads.create({
        autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
        invitable: false,
        name: `ticket-${result.ticket.number}-${member.user.username}`.slice(0, 100),
        reason: `Ticket #${result.ticket.number}`,
        type: ChannelType.PrivateThread,
      });
    } catch (error) {
      await this.tickets.discard(result.ticket.id);
      this.logger.warn(
        { err: toError(error), guildId: member.guild.id },
        "Could not create a ticket thread",
      );
      await respond({
        body: "LunaEcho could not create the ticket thread. The server team must allow LunaEcho to create private threads in the ticket channel.",
        title: "Could not open a ticket",
        tone: "danger",
      });
      return;
    }

    await this.tickets.attachThread(result.ticket.id, thread.id);
    await thread.members.add(member.id);
    // Mentioning the opener and the staff roles adds them to the private thread.
    await thread.send({
      allowedMentions: { roles: [...settings.staffRoleIds], users: [member.id] },
      components: [
        ...this.openingPanel(result.ticket, null),
        ...(settings.staffRoleIds.length === 0
          ? []
          : [
              createPanel({
                body: settings.staffRoleIds.map((roleId) => `<@&${roleId}>`).join(" "),
                title: "Team",
                tone: "neutral",
              }),
            ]),
      ],
      flags: MessageFlags.IsComponentsV2,
    });
    await respond({
      body: `Your ticket is open: <#${thread.id}>`,
      title: "Ticket opened",
      tone: "success",
    });
  }

  /** Posts the transcript, then locks and archives the thread so it stays readable for staff. */
  private async finish(ticket: Ticket, thread: ThreadChannel): Promise<void> {
    await thread.send({
      allowedMentions: { parse: [] },
      components: [
        createPanel({
          body: `Closed by <@${ticket.closedBy ?? ""}>${ticket.closeReason === null ? "" : `\n**Reason:** ${ticket.closeReason}`}`,
          title: "Ticket closed",
          tone: "neutral",
        }),
      ],
      flags: MessageFlags.IsComponentsV2,
    });

    try {
      const settings = await this.tickets.getSettings(ticket.guildId);
      const target =
        settings.transcriptChannelId === null
          ? undefined
          : this.client.channels.cache.get(settings.transcriptChannelId);

      if (target?.isSendable() === true) {
        const messages = await collectTranscript(thread);
        await target.send({
          allowedMentions: { parse: [] },
          content: [
            `**Ticket #${ticket.number}** closed by <@${ticket.closedBy ?? ""}>`,
            `Opened by <@${ticket.openerId}> · ${messages.length} messages · <#${thread.id}>`,
            ...(ticket.closeReason === null ? [] : [`Reason: ${ticket.closeReason}`]),
          ].join("\n"),
          files: [
            new AttachmentBuilder(
              Buffer.from(formatTranscript(ticket, thread.guild.name, messages), "utf8"),
              {
                name: `ticket-${ticket.number}.txt`,
              },
            ),
          ],
        });
      }
    } catch (error) {
      this.logger.warn(
        { err: toError(error), guildId: ticket.guildId },
        "Could not post a ticket transcript",
      );
    }

    await thread.edit({ archived: true, locked: true, reason: `Ticket #${ticket.number} closed` });
  }
}

export function createTicketsModule(context: ModuleContext, database: LunaDatabase): BotModule {
  const logger = context.logger.child({ component: "tickets" });
  const tickets = new TicketService(database);

  return {
    components: [new TicketHandler(tickets, context.client, logger)],
    invalidate: (guildId) => {
      tickets.invalidate(guildId);
    },
    name: "tickets",
    tasks: {
      "post-ticket-panel": async (task) => {
        tickets.invalidate(task.guildId);
        const settings = await tickets.getSettings(task.guildId);
        const channel =
          settings.panelChannelId === null
            ? undefined
            : context.client.channels.cache.get(settings.panelChannelId);

        if (channel?.type !== ChannelType.GuildText) {
          logger.warn({ guildId: task.guildId }, "Ticket channel is missing or not a text channel");
          return;
        }

        if (settings.panelMessageId !== null) {
          await channel.messages.delete(settings.panelMessageId).catch(() => undefined);
        }

        const message = await channel.send({
          allowedMentions: { parse: [] },
          components: [
            createPanel({
              body:
                settings.panelText ??
                "Need help from the team? Open a ticket and describe your request.",
              rows: [
                row(
                  new ButtonBuilder()
                    .setCustomId(ticketIds.open)
                    .setEmoji("🎫")
                    .setLabel("Open ticket")
                    .setStyle(ButtonStyle.Primary),
                ),
              ],
              title: settings.panelTitle ?? "Support",
            }),
          ],
          flags: MessageFlags.IsComponentsV2,
        });
        await tickets.setPanelMessage(task.guildId, message.id);
      },
    },
  };
}
