import { toError, type AppLogger } from "@lunaecho/core";
import {
  maximumReminderTextLength,
  parseDuration,
  type Reminder,
  type ReminderService,
} from "@lunaecho/modules";
import {
  ActionRowBuilder,
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  type Client,
  type MessageActionRowComponentBuilder,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord.js";

import type { ChatInputCommand } from "../../infrastructure/discord/commands/chat-input-command.js";
import type {
  ComponentInteractionHandler,
  RoutedComponentInteraction,
} from "../../infrastructure/discord/commands/component-interaction-registry.js";
import {
  respondWithPanelEphemerally,
  updatePanel,
} from "../../infrastructure/discord/commands/interaction-responder.js";
import { createPanel, type PanelOptions } from "../../infrastructure/discord/components/panel.js";

export const reminderPanelPrefix = "remind:";
const cancelSelectId = "remind:cancel";

export const remindCommandData: RESTPostAPIChatInputApplicationCommandsJSONBody =
  new SlashCommandBuilder()
    .setName("remind")
    .setDescription("Get reminded about something later.")
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("set")
        .setDescription("Set a reminder.")
        .addStringOption((option) =>
          option
            .setName("in")
            .setDescription("When, for example 10m, 2h, 1h30m, or 3d.")
            .setMaxLength(20)
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName("about")
            .setDescription("What to remind you of.")
            .setMaxLength(maximumReminderTextLength)
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("list").setDescription("Show and cancel your reminders."),
    )
    .toJSON();

function relative(date: Date): string {
  return `<t:${Math.floor(date.getTime() / 1_000)}:R>`;
}

function createListPanel(reminders: readonly Reminder[], notice?: string): PanelOptions {
  const prefix = notice === undefined ? "" : `> ${notice}\n\n`;

  if (reminders.length === 0) {
    return { body: `${prefix}You have no reminders in this server.`, title: "Your reminders" };
  }

  const options = reminders.slice(0, 25).map((reminder) => ({
    description: reminder.text.slice(0, 100),
    label: `Due ${reminder.dueAt.toISOString().slice(0, 16).replace("T", " ")} UTC`,
    value: String(reminder.id),
  }));

  return {
    body: `${prefix}${reminders.map((reminder) => `• ${relative(reminder.dueAt)}: ${reminder.text}`).join("\n")}`,
    rows: [
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(cancelSelectId)
          .setPlaceholder("Cancel reminders…")
          .setMinValues(1)
          .setMaxValues(options.length)
          .addOptions(options),
      ),
    ],
    title: "Your reminders",
  };
}

export function createRemindCommand(service: ReminderService): ChatInputCommand {
  return {
    data: remindCommandData,
    guildOnly: true,
    requiredCapability: "utilities",

    async execute({ interaction }): Promise<void> {
      if (!interaction.inCachedGuild()) {
        throw new Error("Remind command executed outside a cached guild");
      }

      if (interaction.options.getSubcommand(true) === "list") {
        await respondWithPanelEphemerally(
          interaction,
          createListPanel(await service.list(interaction.guildId, interaction.user.id)),
        );
        return;
      }

      const delay = parseDuration(interaction.options.getString("in", true));
      const result =
        delay === undefined
          ? ({ kind: "invalid-delay" } as const)
          : await service.create({
              channelId: interaction.channelId,
              delayMilliseconds: delay,
              guildId: interaction.guildId,
              text: interaction.options.getString("about", true),
              userId: interaction.user.id,
            });

      const messages = {
        "invalid-delay": "Use a time between 1 minute and 1 year, such as `10m`, `2h`, or `1h30m`.",
        "invalid-text": "The reminder text cannot be empty.",
        "too-many": "You already have 25 reminders here. Cancel some with `/remind list`.",
      } as const;

      await respondWithPanelEphemerally(
        interaction,
        result.kind === "created"
          ? {
              body: `I will remind you ${relative(result.reminder.dueAt)} in this channel:\n> ${result.reminder.text}`,
              title: "Reminder set",
              tone: "success",
            }
          : { body: messages[result.kind], title: "Reminder not set", tone: "warning" },
      );
    },
  };
}

export class ReminderPanelHandler implements ComponentInteractionHandler {
  public readonly customIdPrefix = reminderPanelPrefix;
  public readonly requiredCapability = "utilities";

  public constructor(private readonly service: ReminderService) {}

  public async handle(interaction: RoutedComponentInteraction): Promise<void> {
    if (!interaction.isStringSelectMenu() || interaction.guildId === null) {
      return;
    }

    const removed = await this.service.cancel(
      interaction.guildId,
      interaction.user.id,
      interaction.values.map(Number),
    );
    await updatePanel(
      interaction,
      createListPanel(
        await this.service.list(interaction.guildId, interaction.user.id),
        `${removed} reminder${removed === 1 ? "" : "s"} cancelled.`,
      ),
    );
  }
}

const deliveryIntervalMilliseconds = 15_000;

/** Sends due reminders in their channel, or by direct message when the channel is gone. */
export class ReminderDelivery {
  private timer: ReturnType<typeof setInterval> | undefined;

  public constructor(
    private readonly service: ReminderService,
    private readonly client: Client,
    private readonly logger: AppLogger,
  ) {}

  public start(): void {
    this.timer = setInterval(() => {
      void this.deliverDue().catch((error: unknown) => {
        this.logger.error({ err: toError(error) }, "Delivering reminders failed");
      });
    }, deliveryIntervalMilliseconds);
    this.timer.unref();
  }

  public close(): Promise<void> {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
    }

    return Promise.resolve();
  }

  public async deliverDue(): Promise<number> {
    const due = await this.service.takeDue(100);

    for (const reminder of due) {
      await this.deliver(reminder);
    }

    return due.length;
  }

  private async deliver(reminder: Reminder): Promise<void> {
    const panel = createPanel({
      body: `<@${reminder.userId}>, you asked me ${relative(reminder.createdAt)} to remind you:\n> ${reminder.text}`,
      title: "Reminder",
    });
    const message = {
      allowedMentions: { users: [reminder.userId] },
      components: [panel],
      flags: MessageFlags.IsComponentsV2,
    } as const;

    try {
      const channel = await this.client.channels.fetch(reminder.channelId);

      if (channel?.isSendable() === true) {
        await channel.send(message);
        return;
      }
    } catch (error) {
      this.logger.debug(
        { err: toError(error), reminderId: reminder.id },
        "Reminder channel unavailable",
      );
    }

    try {
      const user = await this.client.users.fetch(reminder.userId);
      await user.send(message);
    } catch (error) {
      this.logger.warn(
        { err: toError(error), reminderId: reminder.id },
        "Could not deliver a reminder",
      );
    }
  }
}
