import { logLevels, type LogLevel, type RuntimeMode } from "@lunaecho/core";
import { z } from "zod";

const environmentSchema = z.object({
  DATABASE_URL: z
    .string({ error: "is required" })
    .trim()
    .regex(/^postgres(?:ql)?:\/\//, "must be a postgresql:// connection string"),
  DISCORD_APPLICATION_ID: z.string().regex(/^\d{17,20}$/, "must be a Discord snowflake"),
  DISCORD_DEVELOPMENT_GUILD_ID: z
    .string()
    .regex(/^\d{17,20}$/, "must be a Discord snowflake")
    .optional(),
  DISCORD_SMOKE_TEST_CHANNEL_ID: z
    .string()
    .regex(/^\d{17,20}$/, "must be a Discord snowflake")
    .optional(),
  DISCORD_TOKEN: z.string().trim().min(1, "is required"),
  LAVALINK_PASSWORD: z.string().trim().min(1).optional(),
  LAVALINK_SECURE: z.enum(["true", "false"]).default("false"),
  /** Host and port of the Lavalink node, for example `localhost:2333`. Music is off without it. */
  LAVALINK_URL: z
    .string()
    .trim()
    .regex(/^[\w.-]+:\d{1,5}$/, "must be host:port without a protocol")
    .optional(),
  /** Twitch live alerts need an app from dev.twitch.tv; YouTube alerts work without keys. */
  TWITCH_CLIENT_ID: z.string().trim().min(1).optional(),
  TWITCH_CLIENT_SECRET: z.string().trim().min(1).optional(),
  /**
   * Bot accounts that Voice Rooms treats like members, only for live load tests with helper
   * bots on a test server. Leave unset in production.
   */
  LOAD_TEST_BOT_IDS: z
    .string()
    .trim()
    .regex(/^\d{17,20}(?:,\d{17,20})*$/, "must be comma-separated Discord snowflakes")
    .optional(),
  LOG_LEVEL: z.enum(logLevels).default("info"),
  MUSIC_MAXIMUM_SESSIONS: z.coerce.number().int().min(1).max(10_000).default(200),
  MUSIC_SEARCH_SOURCES: z
    .string()
    .trim()
    .regex(/^[a-z]+(?:,[a-z]+)*$/, "must be comma-separated search prefixes such as ytsearch")
    .default("ytsearch,scsearch"),
  // Cloud and Custom are started from private infrastructure, never by an environment switch.
  LUNA_RUNTIME_MODE: z.literal("self-hosted").default("self-hosted"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type AppConfig = Readonly<{
  databaseUrl: string;
  discord: Readonly<{
    applicationId: string;
    developmentGuildId: string | undefined;
    smokeTestChannelId: string | undefined;
    token: string;
  }>;
  lavalink: Readonly<{ password: string; secure: boolean; url: string }> | undefined;
  loadTestBotIds: ReadonlySet<string>;
  logLevel: LogLevel;
  music: Readonly<{ maximumSessions: number; searchSources: readonly string[] }>;
  twitch: Readonly<{ clientId: string; clientSecret: string }> | undefined;
  nodeEnvironment: z.infer<typeof environmentSchema>["NODE_ENV"];
  runtimeMode: Extract<RuntimeMode, "self-hosted">;
  service: "lunaecho-bot";
}>;

export class ConfigurationError extends Error {
  public readonly issues: readonly string[];

  public constructor(issues: readonly string[]) {
    super(`Invalid environment configuration:\n- ${issues.join("\n- ")}`);
    this.name = "ConfigurationError";
    this.issues = issues;
  }
}

export function loadConfig(environment: NodeJS.ProcessEnv): AppConfig {
  const result = environmentSchema.safeParse(environment);

  if (!result.success) {
    throw new ConfigurationError(
      result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    );
  }

  const data = result.data;

  if ((data.LAVALINK_URL === undefined) !== (data.LAVALINK_PASSWORD === undefined)) {
    throw new ConfigurationError(["LAVALINK_URL and LAVALINK_PASSWORD must be set together"]);
  }

  if ((data.TWITCH_CLIENT_ID === undefined) !== (data.TWITCH_CLIENT_SECRET === undefined)) {
    throw new ConfigurationError([
      "TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET must be set together",
    ]);
  }

  return {
    databaseUrl: result.data.DATABASE_URL,
    discord: {
      applicationId: result.data.DISCORD_APPLICATION_ID,
      developmentGuildId: result.data.DISCORD_DEVELOPMENT_GUILD_ID,
      smokeTestChannelId: result.data.DISCORD_SMOKE_TEST_CHANNEL_ID,
      token: result.data.DISCORD_TOKEN,
    },
    lavalink:
      data.LAVALINK_URL === undefined || data.LAVALINK_PASSWORD === undefined
        ? undefined
        : {
            password: data.LAVALINK_PASSWORD,
            secure: data.LAVALINK_SECURE === "true",
            url: data.LAVALINK_URL,
          },
    twitch:
      data.TWITCH_CLIENT_ID === undefined || data.TWITCH_CLIENT_SECRET === undefined
        ? undefined
        : { clientId: data.TWITCH_CLIENT_ID, clientSecret: data.TWITCH_CLIENT_SECRET },
    loadTestBotIds: new Set(data.LOAD_TEST_BOT_IDS?.split(",") ?? []),
    logLevel: result.data.LOG_LEVEL,
    music: {
      maximumSessions: data.MUSIC_MAXIMUM_SESSIONS,
      searchSources: data.MUSIC_SEARCH_SOURCES.split(","),
    },
    nodeEnvironment: result.data.NODE_ENV,
    runtimeMode: result.data.LUNA_RUNTIME_MODE,
    service: "lunaecho-bot",
  };
}
