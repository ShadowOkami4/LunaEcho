import type { DatabaseConnection } from "@lunaecho/db";
import { createTestDatabase, resetTestDatabase } from "@lunaecho/db/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { LogSettingsService, maximumIgnoredLogChannels } from "../src/index.js";

describe("LogSettingsService", () => {
  let connection: DatabaseConnection;
  let service: LogSettingsService;

  beforeAll(async () => {
    connection = await createTestDatabase();
    service = new LogSettingsService(connection.db);
  });

  afterEach(async () => {
    await resetTestDatabase(connection.db);
  });

  afterAll(async () => {
    await connection.close();
  });

  it("logs nothing until a channel is chosen", async () => {
    await expect(service.channelFor("guild-1", "message")).resolves.toBeUndefined();
  });

  it("stores one channel per category and deduplicates ignored channels", async () => {
    const settings = await service.get("guild-1");
    await service.save(
      {
        ...settings,
        channels: { ...settings.channels, message: "logs-messages", moderation: "logs-mod" },
        ignoredChannelIds: ["staff", "staff", "bots"],
      },
      "admin",
    );

    await expect(service.channelFor("guild-1", "message")).resolves.toBe("logs-messages");
    await expect(service.channelFor("guild-1", "voice")).resolves.toBeUndefined();
    await expect(service.get("guild-1")).resolves.toMatchObject({
      ignoredChannelIds: ["staff", "bots"],
    });
    await expect(service.channelFor("guild-2", "message")).resolves.toBeUndefined();
  });

  it("caps the ignored channel list", async () => {
    const settings = await service.get("guild-1");
    await service.save(
      {
        ...settings,
        ignoredChannelIds: Array.from({ length: 80 }, (_, index) => `channel-${index}`),
      },
      "admin",
    );

    expect((await service.get("guild-1")).ignoredChannelIds).toHaveLength(
      maximumIgnoredLogChannels,
    );
  });
});
