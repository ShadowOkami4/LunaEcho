import "../config/load-env.js";

import { createLogger, toError } from "@lunaecho/core";

import { loadConfig } from "../config/environment.js";
import { runDiscordSmokeTest } from "../infrastructure/discord/discord-smoke-test.js";

const config = loadConfig(process.env);
const logger = createLogger(config);

if (config.discord.developmentGuildId === undefined) {
  logger.fatal("DISCORD_DEVELOPMENT_GUILD_ID is required for the Discord smoke test");
  process.exitCode = 1;
} else {
  try {
    await runDiscordSmokeTest({
      channelId: config.discord.smokeTestChannelId,
      guildId: config.discord.developmentGuildId,
      logger,
      token: config.discord.token,
    });
  } catch (error) {
    logger.fatal({ err: toError(error) }, "Discord smoke test failed");
    process.exitCode = 1;
  }
}
