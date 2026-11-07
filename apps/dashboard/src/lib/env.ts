import "server-only";

import { loadNearestEnvFile, runtimeModes } from "@lunaecho/core";
import { z } from "zod";

loadNearestEnvFile(process.cwd());

const environmentSchema = z.object({
  /**
   * The separately run billing service and the secret both share for signed handoffs. Without
   * them the Custom bots page shows no purchase or billing buttons.
   */
  BILLING_HANDOFF_SECRET: z.string().min(32, "must contain at least 32 characters").optional(),
  BILLING_URL: z.url().optional(),
  DASHBOARD_URL: z.url().default("http://localhost:3000"),
  DATABASE_URL: z
    .string({ error: "is required" })
    .regex(/^postgres(?:ql)?:\/\//, "must be a postgresql:// connection string"),
  DISCORD_APPLICATION_ID: z.string().regex(/^\d{17,20}$/, "must be a Discord snowflake"),
  DISCORD_CLIENT_SECRET: z.string().min(1, "is required for the Discord login"),
  DISCORD_TOKEN: z.string().min(1, "is required"),
  /**
   * The key file that seals Custom bot tokens; the same file the orchestrator reads. Without it
   * the Custom bots page explains that Custom is not set up on this dashboard.
   */
  CUSTOM_BOT_TOKEN_KEY_FILE: z.string().min(1).optional(),
  /**
   * Where Custom bots' databases live, as the dashboard reaches them (custom-postgres:5432), and
   * the orchestrator's secrets folder holding each bot's database password. With both set, owners
   * can edit their Custom bots' server settings here.
   */
  CUSTOM_DATABASE_HOST: z
    .string()
    .regex(/^[\w.-]+:\d+$/, "must be host:port")
    .optional(),
  CUSTOM_SECRETS_DIR: z.string().min(1).optional(),
  /** Must match the bot's mode, so both agree on each server's plan. */
  LUNA_RUNTIME_MODE: z.enum(runtimeModes).default("self-hosted"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  SESSION_SECRET: z.string().min(32, "must contain at least 32 characters"),
});

export type DashboardEnvironment = z.infer<typeof environmentSchema>;

let cached: DashboardEnvironment | undefined;

/** Validated lazily so `next build` works without secrets; the first request fails loudly. */
export function env(): DashboardEnvironment {
  if (cached !== undefined) {
    return cached;
  }

  const result = environmentSchema.safeParse(process.env);

  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    throw new Error(`Invalid dashboard configuration:\n- ${issues.join("\n- ")}`);
  }

  cached = result.data;
  return cached;
}
