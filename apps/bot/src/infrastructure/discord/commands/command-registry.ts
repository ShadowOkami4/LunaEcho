import type { RESTPostAPIChatInputApplicationCommandsJSONBody } from "discord.js";

import type { ChatInputCommand } from "./chat-input-command.js";

export class DuplicateCommandError extends Error {
  public constructor(public readonly commandName: string) {
    super(`A command named '${commandName}' is already registered`);
    this.name = "DuplicateCommandError";
  }
}

export class CommandRegistry {
  private readonly commandsByName: ReadonlyMap<string, ChatInputCommand>;

  public constructor(commands: readonly ChatInputCommand[]) {
    const commandMap = new Map<string, ChatInputCommand>();

    for (const command of commands) {
      if (commandMap.has(command.data.name)) {
        throw new DuplicateCommandError(command.data.name);
      }

      commandMap.set(command.data.name, command);
    }

    this.commandsByName = commandMap;
  }

  public find(commandName: string): ChatInputCommand | undefined {
    return this.commandsByName.get(commandName);
  }

  public definitions(): readonly RESTPostAPIChatInputApplicationCommandsJSONBody[] {
    return [...this.commandsByName.values()].map((command) => command.data);
  }
}
