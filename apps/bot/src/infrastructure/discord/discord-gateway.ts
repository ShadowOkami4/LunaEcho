import { toError, type AppLogger } from "@lunaecho/core";
import { Client, Events, Partials, type GatewayIntentBits } from "discord.js";

import type { AnyEventListener } from "./bot-module.js";
import type { InteractionDispatcher } from "./commands/interaction-dispatcher.js";
import { createDiscordCacheOptions } from "./discord-cache-options.js";
import type { MessageCreateHandler } from "./discord-event-handler.js";

export interface BotGateway {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

export type DiscordGatewayOptions = Readonly<{
  client: Client;
  interactionDispatcher: InteractionDispatcher;
  listeners?: readonly AnyEventListener[];
  logger: AppLogger;
  /** Run in order for every message; a handler returning "stop" ends the chain. */
  messageCreateHandlers?: readonly MessageCreateHandler[];
  readyHandlers?: readonly ((client: Client<true>) => Promise<void>)[];
  token: string;
}>;

/**
 * Creates the discord.js client with bounded caches. Partial messages and members let the logs
 * module see deletions and departures of things that were never cached.
 */
export function createDiscordClient(intents: readonly GatewayIntentBits[]): Client {
  return new Client({
    ...createDiscordCacheOptions(),
    intents: [...intents],
    partials: [Partials.Message, Partials.Channel, Partials.GuildMember, Partials.User],
  });
}

export class DiscordGateway implements BotGateway {
  private readonly client: Client;
  private readonly logger: AppLogger;

  public constructor(private readonly options: DiscordGatewayOptions) {
    this.client = options.client;
    this.logger = options.logger;

    this.client.once(Events.ClientReady, (readyClient) => {
      this.logger.info(
        {
          guildCount: readyClient.guilds.cache.size,
          userId: readyClient.user.id,
          username: readyClient.user.username,
        },
        "Discord client is ready",
      );

      for (const handler of options.readyHandlers ?? []) {
        void this.run("ready", {}, () => handler(readyClient));
      }
    });

    this.client.on(Events.Error, (error) => {
      this.logger.error({ err: error }, "Discord client emitted an error");
    });

    this.client.on(Events.Warn, (warning) => {
      this.logger.warn({ warning }, "Discord client emitted a warning");
    });

    this.client.on(Events.InteractionCreate, (interaction) => {
      void options.interactionDispatcher.handle(interaction).catch((error: unknown) => {
        this.logger.error({ err: error }, "Interaction dispatcher failed unexpectedly");
      });
    });

    if ((options.messageCreateHandlers ?? []).length > 0) {
      this.client.on(Events.MessageCreate, (message) => {
        void this.handleMessageCreate(message);
      });
    }

    for (const listener of options.listeners ?? []) {
      // Each listener is isolated: one failing module never affects another.
      this.client.on(listener.event, (...args: unknown[]) => {
        void this.run(listener.name, { event: listener.event }, () =>
          (listener.handle as (...values: unknown[]) => Promise<void>)(...args),
        );
      });
    }
  }

  public async connect(): Promise<void> {
    await this.client.login(this.options.token);
  }

  public async disconnect(): Promise<void> {
    await this.client.destroy();
  }

  private async handleMessageCreate(
    message: Parameters<MessageCreateHandler["handle"]>[0],
  ): Promise<void> {
    for (const handler of this.options.messageCreateHandlers ?? []) {
      try {
        const result = await handler.handle(message);

        if (result === "stop") {
          break;
        }
      } catch (error) {
        this.logger.error(
          {
            err: error,
            guildId: message.guildId,
            handler: handler.constructor.name,
            messageId: message.id,
          },
          "Discord message-create handler failed unexpectedly",
        );
      }
    }
  }

  private async run(
    name: string,
    context: Readonly<Record<string, string>>,
    task: () => Promise<void>,
  ): Promise<void> {
    try {
      await task();
    } catch (error) {
      this.logger.error(
        { ...context, err: toError(error), listener: name },
        "Discord event handler failed unexpectedly",
      );
    }
  }
}
