import "./config/load-env.js";

import { createLogger, toError } from "@lunaecho/core";

import { createApplication } from "./app/create-application.js";
import type { LunaApplication } from "./app/luna-application.js";
import { loadConfig } from "./config/environment.js";

const config = loadConfig(process.env);
const logger = createLogger(config);

let application: LunaApplication | undefined;
let shutdownStarted = false;

async function shutdown(reason: string, exitCode: number): Promise<void> {
  if (shutdownStarted) {
    return;
  }

  shutdownStarted = true;
  logger.info({ reason }, "Shutdown requested");

  try {
    await application?.stop();
  } catch (error) {
    exitCode = 1;
    logger.error({ err: toError(error) }, "Graceful shutdown failed");
  } finally {
    process.exitCode = exitCode;
  }
}

process.once("SIGINT", () => {
  void shutdown("SIGINT", 0);
});

process.once("SIGTERM", () => {
  void shutdown("SIGTERM", 0);
});

process.on("unhandledRejection", (reason) => {
  logger.fatal({ err: toError(reason) }, "Unhandled promise rejection");
  void shutdown("unhandledRejection", 1);
});

process.on("uncaughtException", (error) => {
  logger.fatal({ err: error }, "Uncaught exception");
  void shutdown("uncaughtException", 1);
});

try {
  application = await createApplication(config, logger);
  await application.start();
} catch (error) {
  logger.fatal({ err: toError(error) }, "Application startup failed");
  await shutdown("startupFailure", 1);
}
