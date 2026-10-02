import { describe, expect, it } from "vitest";

import { ConfigurationError, loadConfig } from "../../src/config/environment.js";

const databaseUrl = "postgresql://lunaecho:secret-password@localhost:5432/lunaecho";

describe("loadConfig", () => {
  it("parses a valid self-hosted configuration", () => {
    const config = loadConfig({
      DATABASE_URL: databaseUrl,
      DISCORD_APPLICATION_ID: "123456789012345678",
      DISCORD_TOKEN: "test-token",
      NODE_ENV: "test",
    });

    expect(config).toEqual({
      databaseUrl,
      discord: {
        applicationId: "123456789012345678",
        developmentGuildId: undefined,
        smokeTestChannelId: undefined,
        token: "test-token",
      },
      lavalink: undefined,
      loadTestBotIds: new Set(),
      logLevel: "info",
      music: { maximumSessions: 200, searchSources: ["ytsearch", "scsearch"] },
      nodeEnvironment: "test",
      runtimeMode: "self-hosted",
      service: "lunaecho-bot",
    });
  });

  it("reports every invalid environment field without exposing values", () => {
    const environment = {
      DATABASE_URL: "mysql://lunaecho:secret-password@localhost/lunaecho",
      DISCORD_APPLICATION_ID: "not-a-snowflake",
      DISCORD_TOKEN: "",
      LUNA_RUNTIME_MODE: "cloud-custom",
    };

    expect(() => loadConfig(environment)).toThrow(ConfigurationError);

    try {
      loadConfig(environment);
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      expect((error as ConfigurationError).issues).toHaveLength(4);
      expect((error as Error).message).not.toContain("secret-password");
      expect((error as Error).message).not.toContain("cloud-custom: ");
    }
  });

  it("requires a database connection string", () => {
    expect(() =>
      loadConfig({
        DISCORD_APPLICATION_ID: "123456789012345678",
        DISCORD_TOKEN: "test-token",
      }),
    ).toThrow("DATABASE_URL: is required");
  });

  it("configures Lavalink only when address and password are both set", () => {
    const base = {
      DATABASE_URL: databaseUrl,
      DISCORD_APPLICATION_ID: "123456789012345678",
      DISCORD_TOKEN: "test-token",
    };

    expect(
      loadConfig({ ...base, LAVALINK_PASSWORD: "youshallnotpass", LAVALINK_URL: "localhost:2333" })
        .lavalink,
    ).toEqual({ password: "youshallnotpass", secure: false, url: "localhost:2333" });
    expect(() => loadConfig({ ...base, LAVALINK_URL: "localhost:2333" })).toThrow(
      "LAVALINK_URL and LAVALINK_PASSWORD must be set together",
    );
    expect(() => loadConfig({ ...base, LAVALINK_URL: "http://localhost:2333" })).toThrow(
      ConfigurationError,
    );
  });
});
