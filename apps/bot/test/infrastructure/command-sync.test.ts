import { createLogger } from "@lunaecho/core";
import { describe, expect, it } from "vitest";

import {
  syncApplicationCommands,
  type CommandSyncTarget,
  type GuildCommandScope,
} from "../../src/infrastructure/discord/commands/command-sync.js";
import { createCommandDefinitions } from "../../src/modules/command-definitions.js";

const logger = createLogger({ logLevel: "silent", nodeEnvironment: "test", service: "test" });

function guild(
  id: string,
  commands: number,
  readable = true,
): GuildCommandScope & { left: number } {
  const scope = {
    clear: () => {
      scope.left = 0;
      return Promise.resolve();
    },
    count: () =>
      readable ? Promise.resolve(scope.left) : Promise.reject(new Error("Missing Access")),
    id,
    left: commands,
  };
  return scope;
}

describe("syncApplicationCommands", () => {
  it("replaces the global commands and clears leftover server commands", async () => {
    const definitions = createCommandDefinitions();
    let registered: readonly unknown[] = [];
    const leftover = guild("1", 1);
    const clean = guild("2", 0);
    const locked = guild("3", 4, false);
    const target: CommandSyncTarget = {
      guilds: () => [leftover, clean, locked],
      setGlobal: (commands) => {
        registered = commands;
        return Promise.resolve(commands.length);
      },
    };

    await expect(syncApplicationCommands(target, definitions, logger)).resolves.toEqual({
      clearedGuilds: 1,
      commandCount: definitions.length,
    });
    expect(registered).toEqual(definitions);
    expect([leftover.left, clean.left, locked.left]).toEqual([0, 0, 4]);
  });
});
