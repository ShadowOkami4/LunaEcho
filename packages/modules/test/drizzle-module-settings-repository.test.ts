import type { DatabaseConnection } from "@lunaecho/db";
import { createTestDatabase, resetTestDatabase } from "@lunaecho/db/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { DrizzleModuleSettingsRepository } from "../src/index.js";

describe("DrizzleModuleSettingsRepository", () => {
  let connection: DatabaseConnection;
  let repository: DrizzleModuleSettingsRepository;

  beforeAll(async () => {
    connection = await createTestDatabase();
    repository = new DrizzleModuleSettingsRepository(connection.db);
  });

  afterEach(async () => {
    await resetTestDatabase(connection.db);
  });

  afterAll(async () => {
    await connection.close();
  });

  it("stores module switches independently per guild", async () => {
    const timestamp = new Date("2026-01-01T00:00:00.000Z");

    await repository.setEnabled("guild-1", "moderation", false, "admin-1", timestamp);

    await expect(repository.listOverrides("guild-1")).resolves.toEqual(
      new Map([["moderation", false]]),
    );
    await expect(repository.listOverrides("guild-2")).resolves.toEqual(new Map());
  });

  it("overwrites an existing switch instead of duplicating it", async () => {
    const timestamp = new Date("2026-01-01T00:00:00.000Z");

    await repository.setEnabled("guild-1", "moderation", false, "admin-1", timestamp);
    await repository.setEnabled("guild-1", "moderation", true, "admin-2", timestamp);

    await expect(repository.listOverrides("guild-1")).resolves.toEqual(
      new Map([["moderation", true]]),
    );
  });
});
