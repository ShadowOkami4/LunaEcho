import "../config/load-env.js";

import { createLogger, toError } from "@lunaecho/core";

import { loadConfig } from "../config/environment.js";
import { resolveCommandDeploymentTarget } from "../infrastructure/discord/commands/command-deployment-target.js";
import { deployCommands } from "../infrastructure/discord/commands/deploy-commands.js";
import { createCommandDefinitions } from "../modules/command-definitions.js";

const config = loadConfig(process.env);
const logger = createLogger(config);

try {
  const target = resolveCommandDeploymentTarget(
    process.argv.slice(2),
    config.discord.developmentGuildId,
  );
  await deployCommands({
    applicationId: config.discord.applicationId,
    definitions: createCommandDefinitions(),
    logger,
    target,
    token: config.discord.token,
  });
} catch (error) {
  logger.fatal({ err: toError(error) }, "Command deployment failed");
  process.exitCode = 1;
}
