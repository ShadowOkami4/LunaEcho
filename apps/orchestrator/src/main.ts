import { readFileSync } from "node:fs";

import { createLogger, toError } from "@lunaecho/core";
import { connectDatabase } from "@lunaecho/db";
import { CustomBotService, TokenVault } from "@lunaecho/modules";
import { z } from "zod";

import { PostgresProvisioner } from "./database-provisioner.js";
import { DockerClient } from "./docker-client.js";
import { Reconciler } from "./reconciler.js";
import { FileSecretStore } from "./secret-store.js";
import { UsageMeter } from "./usage-meter.js";

/** Values may come from files, like Docker secrets; the file wins when both are missing. */
function secret(name: string): string | undefined {
  const file = process.env[`${name}_FILE`];
  return file === undefined ? process.env[name] : readFileSync(file, "utf8").trim();
}

const environment = z
  .object({
    /** The central database with the custom_bots table (the Cloud database). */
    CONTROL_DATABASE_URL: z.string().regex(/^postgres(?:ql)?:\/\//),
    /** Superuser of the Custom database server, used to create and drop customer databases. */
    CUSTOM_DATABASE_ADMIN_URL: z.string().regex(/^postgres(?:ql)?:\/\//),
    CUSTOM_DATABASE_HOST: z.string().default("custom-postgres:5432"),
    CUSTOM_BOT_IMAGE: z.string().default("lunaecho-bot:latest"),
    CUSTOM_BOT_MEMORY_MB: z.coerce.number().int().min(128).max(2048).default(256),
    CUSTOM_NETWORK: z.string().default("lunaecho-custom"),
    CUSTOM_SECRETS_VOLUME: z.string().default("lunaecho-custom-secrets"),
    LAVALINK_PASSWORD: z.string().min(1).optional(),
    LAVALINK_URL: z.string().optional(),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    RECONCILE_INTERVAL_SECONDS: z.coerce.number().int().min(2).max(300).default(10),
    SECRETS_ROOT: z.string().default("/secrets"),
    TOKEN_KEY_FILE: z.string().default("/run/secrets/token-key"),
  })
  .parse({
    ...process.env,
    CONTROL_DATABASE_URL: secret("CONTROL_DATABASE_URL"),
    CUSTOM_DATABASE_ADMIN_URL: secret("CUSTOM_DATABASE_ADMIN_URL"),
    LAVALINK_PASSWORD: secret("LAVALINK_PASSWORD"),
  });

const logger = createLogger({
  logLevel: environment.LOG_LEVEL,
  nodeEnvironment: "production",
  service: "lunaecho-orchestrator",
});

const control = await connectDatabase({
  connectionString: environment.CONTROL_DATABASE_URL,
  poolSize: 2,
  // The Cloud bot owns the control database's schema; the orchestrator only reads and reports.
  runMigrations: false,
});
const databases = new PostgresProvisioner(
  environment.CUSTOM_DATABASE_ADMIN_URL,
  environment.CUSTOM_DATABASE_HOST,
);
const customBots = new CustomBotService(
  control.db,
  TokenVault.fromKeyFile(environment.TOKEN_KEY_FILE),
);
const reconciler = new Reconciler(
  customBots,
  new DockerClient(),
  databases,
  new FileSecretStore(environment.SECRETS_ROOT),
  {
    image: environment.CUSTOM_BOT_IMAGE,
    lavalink:
      environment.LAVALINK_URL === undefined || environment.LAVALINK_PASSWORD === undefined
        ? undefined
        : { password: environment.LAVALINK_PASSWORD, url: environment.LAVALINK_URL },
    memoryBytes: environment.CUSTOM_BOT_MEMORY_MB * 1024 * 1024,
    network: environment.CUSTOM_NETWORK,
    secretsVolume: environment.CUSTOM_SECRETS_VOLUME,
  },
  logger,
);

let running = false;
let stopping = false;

async function pass(): Promise<void> {
  // Passes never overlap; a slow Docker call just delays the next one.
  if (running || stopping) {
    return;
  }

  running = true;

  try {
    await reconciler.reconcileOnce();
  } catch (error) {
    logger.error({ err: toError(error) }, "Reconcile pass failed");
  } finally {
    running = false;
  }
}

const timer = setInterval(() => {
  void pass();
}, environment.RECONCILE_INTERVAL_SECONDS * 1_000);

// Size readings for billing: checked hourly, taken once per bot and UTC day.
const meter = new UsageMeter(customBots, logger);
let measuring = false;

async function measure(): Promise<void> {
  if (measuring || stopping) {
    return;
  }

  measuring = true;

  try {
    await meter.measureOnce();
  } catch (error) {
    logger.error({ err: toError(error) }, "Size readings failed");
  } finally {
    measuring = false;
  }
}

const meterTimer = setInterval(() => {
  void measure();
}, 3_600_000);

async function shutdown(signal: string): Promise<void> {
  stopping = true;
  clearInterval(timer);
  clearInterval(meterTimer);
  logger.info({ signal }, "Orchestrator stopping");
  await control.close();
  await databases.close();
  process.exit(0);
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

logger.info({ image: environment.CUSTOM_BOT_IMAGE }, "Orchestrator started");
await pass();
void measure();
