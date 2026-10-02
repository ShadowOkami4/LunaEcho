import {
  CapabilityUnavailableError,
  getModuleDescriptor,
  toError,
  type AppLogger,
  type EntitlementService,
} from "@lunaecho/core";
import type { ChatInputCommandInteraction, Interaction } from "discord.js";

import type { ModuleGate } from "@lunaecho/modules";
import type { ChatInputCommand } from "./chat-input-command.js";
import {
  ComponentInteractionRegistry,
  type RoutedComponentInteraction,
} from "./component-interaction-registry.js";
import type { CommandRegistry } from "./command-registry.js";
import { respondWithPanelEphemerally } from "./interaction-responder.js";

const everyModuleEnabled: ModuleGate = {
  isEnabled: () => Promise.resolve(true),
};

export class InteractionDispatcher {
  public constructor(
    private readonly commands: CommandRegistry,
    private readonly entitlements: EntitlementService,
    private readonly logger: AppLogger,
    private readonly components = new ComponentInteractionRegistry([]),
    private readonly modules: ModuleGate = everyModuleEnabled,
  ) {}

  public async handle(interaction: Interaction): Promise<void> {
    if (interaction.isChatInputCommand()) {
      await this.handleCommand(interaction);
      return;
    }

    if (
      interaction.isButton() ||
      interaction.isModalSubmit() ||
      interaction.isStringSelectMenu() ||
      interaction.isChannelSelectMenu() ||
      interaction.isRoleSelectMenu() ||
      interaction.isUserSelectMenu()
    ) {
      await this.handleComponent(interaction);
    }
  }

  private async handleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const command = this.commands.find(interaction.commandName);
    const commandLogger = this.logger.child({
      commandName: interaction.commandName,
      guildId: interaction.guildId,
      interactionId: interaction.id,
      interactionType: "command",
      userId: interaction.user.id,
    });

    if (command === undefined) {
      commandLogger.warn("Received an interaction for an unknown command");
      await respondWithPanelEphemerally(interaction, {
        body: "This command is no longer available. Discord may still be refreshing commands.",
        title: "Command unavailable",
        tone: "warning",
      });
      return;
    }

    const startedAt = Date.now();

    try {
      if (!(await this.authorizeCommand(command, interaction))) {
        return;
      }

      await command.execute({
        entitlements: this.entitlements,
        interaction,
        logger: commandLogger,
      });

      commandLogger.info({ durationMs: Date.now() - startedAt }, "Command completed");
    } catch (error) {
      await this.handleExecutionError(error, interaction, commandLogger, startedAt, "Command");
    }
  }

  private async handleComponent(interaction: RoutedComponentInteraction): Promise<void> {
    const handler = this.components.find(interaction.customId);
    const componentLogger = this.logger.child({
      customId: interaction.customId,
      guildId: interaction.guildId,
      interactionId: interaction.id,
      interactionType: interaction.isButton()
        ? "button"
        : interaction.isStringSelectMenu()
          ? "string-select"
          : interaction.isChannelSelectMenu()
            ? "channel-select"
            : interaction.isRoleSelectMenu()
              ? "role-select"
              : interaction.isUserSelectMenu()
                ? "user-select"
                : "modal",
      userId: interaction.user.id,
    });

    if (handler === undefined) {
      componentLogger.warn("Received an interaction for an unknown component");
      await respondWithPanelEphemerally(interaction, {
        body: "This control is unavailable or belongs to an outdated panel.",
        title: "Control unavailable",
        tone: "warning",
      });
      return;
    }

    const startedAt = Date.now();

    try {
      if (
        !(await this.authorize(
          interaction,
          handler.requiredMemberPermissions,
          handler.requiredCapability,
        ))
      ) {
        return;
      }

      await handler.handle(interaction, componentLogger);
      componentLogger.info(
        { durationMs: Date.now() - startedAt },
        "Component interaction completed",
      );
    } catch (error) {
      await this.handleExecutionError(
        error,
        interaction,
        componentLogger,
        startedAt,
        "Component interaction",
      );
    }
  }

  private authorizeCommand(
    command: ChatInputCommand,
    interaction: ChatInputCommandInteraction,
  ): Promise<boolean> {
    if (command.guildOnly === true && interaction.guildId === null) {
      return respondWithPanelEphemerally(interaction, {
        body: "This command can only be used inside a server.",
        title: "Server required",
        tone: "warning",
      }).then(() => false);
    }

    return this.authorize(
      interaction,
      command.requiredMemberPermissions,
      command.requiredCapability,
    );
  }

  private async authorize(
    interaction: ChatInputCommandInteraction | RoutedComponentInteraction,
    requiredMemberPermissions: bigint | undefined,
    requiredCapability: ChatInputCommand["requiredCapability"],
  ): Promise<boolean> {
    if (
      requiredMemberPermissions !== undefined &&
      interaction.memberPermissions?.has(requiredMemberPermissions) !== true
    ) {
      await respondWithPanelEphemerally(interaction, {
        body: "You do not have permission to use this administrative control.",
        title: "Permission denied",
        tone: "danger",
      });
      return false;
    }

    if (requiredCapability !== undefined) {
      if (interaction.guildId === null) {
        await respondWithPanelEphemerally(interaction, {
          body: "This feature can only be used inside a server.",
          title: "Server required",
          tone: "warning",
        });
        return false;
      }

      await this.entitlements.require(interaction.guildId, requiredCapability);

      if (!(await this.modules.isEnabled(interaction.guildId, requiredCapability))) {
        const moduleName = getModuleDescriptor(requiredCapability).displayName;
        await respondWithPanelEphemerally(interaction, {
          body: `**${moduleName}** is disabled in this server. An administrator can enable it with \`/modules enable\`.`,
          title: "Module disabled",
          tone: "warning",
        });
        return false;
      }
    }

    return true;
  }

  private async handleExecutionError(
    error: unknown,
    interaction: ChatInputCommandInteraction | RoutedComponentInteraction,
    logger: AppLogger,
    startedAt: number,
    operationName: string,
  ): Promise<void> {
    if (error instanceof CapabilityUnavailableError) {
      logger.info(
        { capability: error.capability, planId: error.planId },
        `${operationName} blocked by entitlement policy`,
      );
      await respondWithPanelEphemerally(interaction, {
        body: "This feature is not available with the server's current plan.",
        title: "Feature locked",
        tone: "warning",
      });
      return;
    }

    logger.error(
      { durationMs: Date.now() - startedAt, err: toError(error) },
      `${operationName} failed`,
    );
    await respondWithPanelEphemerally(interaction, {
      body: "Something went wrong while processing this interaction. Please try again later.",
      title: "Interaction failed",
      tone: "danger",
    });
  }
}
