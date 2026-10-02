import type { ModuleId } from "@lunaecho/core";
import type { Message } from "discord.js";

import type { ModuleGate } from "@lunaecho/modules";
import type { MessageCreateHandler, MessageCreateHandlingResult } from "./discord-event-handler.js";

/** Skips a module's message handler in guilds where that module is switched off. */
export class ModuleGatedMessageHandler implements MessageCreateHandler {
  public constructor(
    private readonly moduleId: ModuleId,
    private readonly modules: ModuleGate,
    private readonly handler: MessageCreateHandler,
  ) {}

  public async handle(message: Message): Promise<MessageCreateHandlingResult> {
    if (
      message.guildId !== null &&
      !(await this.modules.isEnabled(message.guildId, this.moduleId))
    ) {
      return "continue";
    }

    return this.handler.handle(message);
  }
}
