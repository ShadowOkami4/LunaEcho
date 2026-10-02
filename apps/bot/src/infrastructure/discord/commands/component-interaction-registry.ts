import type { AppLogger, Capability } from "@lunaecho/core";
import type {
  ButtonInteraction,
  ChannelSelectMenuInteraction,
  ModalSubmitInteraction,
  RoleSelectMenuInteraction,
  StringSelectMenuInteraction,
  UserSelectMenuInteraction,
} from "discord.js";

export type RoutedComponentInteraction =
  | ButtonInteraction
  | ChannelSelectMenuInteraction
  | ModalSubmitInteraction
  | RoleSelectMenuInteraction
  | StringSelectMenuInteraction
  | UserSelectMenuInteraction;

export interface ComponentInteractionHandler {
  readonly customIdPrefix: string;
  readonly requiredCapability?: Capability;
  readonly requiredMemberPermissions?: bigint;

  handle(interaction: RoutedComponentInteraction, logger: AppLogger): Promise<void>;
}

export class DuplicateComponentHandlerError extends Error {
  public constructor(public readonly customIdPrefix: string) {
    super(`A component handler for prefix '${customIdPrefix}' is already registered`);
    this.name = "DuplicateComponentHandlerError";
  }
}

export class ComponentInteractionRegistry {
  private readonly handlers: readonly ComponentInteractionHandler[];

  public constructor(handlers: readonly ComponentInteractionHandler[]) {
    const prefixes = new Set<string>();

    for (const handler of handlers) {
      if (prefixes.has(handler.customIdPrefix)) {
        throw new DuplicateComponentHandlerError(handler.customIdPrefix);
      }

      prefixes.add(handler.customIdPrefix);
    }

    this.handlers = [...handlers].sort(
      (left, right) => right.customIdPrefix.length - left.customIdPrefix.length,
    );
  }

  public find(customId: string): ComponentInteractionHandler | undefined {
    return this.handlers.find((handler) => customId.startsWith(handler.customIdPrefix));
  }
}
