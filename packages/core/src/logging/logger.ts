import pino, { type Logger, type LoggerOptions } from "pino";

export type AppLogger = Logger;

export const logLevels = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;

export type LogLevel = (typeof logLevels)[number];

export type LoggerConfig = Readonly<{
  logLevel: LogLevel;
  nodeEnvironment: "development" | "production" | "test";
  service: string;
}>;

export function createLogger(config: LoggerConfig): AppLogger {
  const options = {
    base: {
      component: "app",
      environment: config.nodeEnvironment,
      service: config.service,
    },
    level: config.logLevel,
    redact: {
      censor: "[REDACTED]",
      paths: [
        "connectionString",
        "databaseUrl",
        "discord.token",
        "token",
        "req.headers.authorization",
        "request.headers.authorization",
      ],
    },
    serializers: {
      err: pino.stdSerializers.err,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  } satisfies LoggerOptions;

  if (config.nodeEnvironment === "production") {
    return pino(options);
  }

  return pino(
    options,
    pino.transport({
      target: "pino-pretty",
      options: {
        colorize: process.stdout.isTTY,
        colorizeObjects: process.stdout.isTTY,
        ignore: "pid,hostname,service,environment,component",
        messageFormat: "{component} | {msg}",
        singleLine: false,
        translateTime: "SYS:yyyy-mm-dd HH:MM:ss.l",
      },
    }),
  );
}
