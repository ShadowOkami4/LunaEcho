import { REST, Routes, type RESTPostAPIChatInputApplicationCommandsJSONBody } from "discord.js";

import type { AppLogger } from "@lunaecho/core";
import type { CommandDeploymentTarget } from "./command-deployment-target.js";

export type DeployCommandsOptions = Readonly<{
  applicationId: string;
  definitions: readonly RESTPostAPIChatInputApplicationCommandsJSONBody[];
  logger: AppLogger;
  target: CommandDeploymentTarget;
  token: string;
}>;

export async function deployCommands(options: DeployCommandsOptions): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(options.token);
  const definitions = options.definitions;
  const route =
    options.target.scope === "guild"
      ? Routes.applicationGuildCommands(options.applicationId, options.target.guildId)
      : Routes.applicationCommands(options.applicationId);

  options.logger.info(
    {
      commandCount: definitions.length,
      scope: options.target.scope,
      ...(options.target.scope === "guild" ? { guildId: options.target.guildId } : {}),
    },
    "Deploying Discord application commands",
  );

  await rest.put(route, { body: definitions });
  options.logger.info("Discord application commands deployed");
}
