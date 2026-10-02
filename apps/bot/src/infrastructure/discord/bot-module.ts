import type { AppLogger, ModuleId } from "@lunaecho/core";
import type { BotTask } from "@lunaecho/modules";
import type { Client, ClientEvents } from "discord.js";

import type { CloseableResource } from "../../app/luna-application.js";
import type { ChatInputCommand } from "./commands/chat-input-command.js";
import type { ComponentInteractionHandler } from "./commands/component-interaction-registry.js";
import type { MessageCreateHandler } from "./discord-event-handler.js";

/** Reacts to one discord.js client event. Failures are logged and never affect other listeners. */
export type EventListener<Event extends keyof ClientEvents> = Readonly<{
  event: Event;
  handle: (...args: ClientEvents[Event]) => Promise<void>;
  /** Shown in logs when the listener fails. */
  name: string;
}>;

export type AnyEventListener = {
  [Event in keyof ClientEvents]: EventListener<Event>;
}[keyof ClientEvents];

export function listen<Event extends keyof ClientEvents>(
  event: Event,
  name: string,
  handle: (...args: ClientEvents[Event]) => Promise<void>,
): AnyEventListener {
  return { event, handle, name } as AnyEventListener;
}

export type TaskHandler = (task: BotTask) => Promise<void>;

/**
 * Everything one feature module contributes to the running bot. The application collects these
 * and wires them into the command registry, the gateway, and the task runner.
 */
export type BotModule = Readonly<{
  commands?: readonly ChatInputCommand[];
  components?: readonly ComponentInteractionHandler[];
  /** Drops cached settings for a guild after the dashboard changed them. */
  invalidate?: (guildId: string) => void;
  listeners?: readonly AnyEventListener[];
  /**
   * Runs for every guild message in module order. AutoMod comes first and may stop the chain,
   * so later modules never act on a message it removed.
   */
  messageHandlers?: readonly MessageCreateHandler[];
  name: ModuleId | "system";
  onReady?: (client: Client<true>) => Promise<void>;
  resources?: readonly CloseableResource[];
  tasks?: Readonly<Record<string, TaskHandler>>;
}>;

/** What every module factory receives. */
export type ModuleContext = Readonly<{
  client: Client;
  logger: AppLogger;
  /** Whether a module may act in a guild: the plan includes it and it is switched on. */
  moduleRuns: (guildId: string, moduleId: ModuleId) => Promise<boolean>;
}>;
