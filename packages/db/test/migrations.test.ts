import { getTableName, is, sql } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  guildAutomodRules,
  guildModerationSettings,
  type DatabaseConnection,
} from "../src/index.js";
import * as schema from "../src/schema.js";
import { createTestDatabase, resetTestDatabase } from "../src/testing.js";

describe("database migrations", () => {
  let connection: DatabaseConnection;

  beforeAll(async () => {
    connection = await createTestDatabase();
  });

  afterAll(async () => {
    await connection.close();
  });

  it("creates every LunaEcho table", async () => {
    // The driver-independent handle leaves raw query results untyped.
    const result = (await connection.db.execute(
      sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
    )) as { rows: { table_name: string }[] };

    const expected = Object.values(schema)
      .filter((value) => is(value, PgTable))
      .map((table) => getTableName(table))
      .sort();

    expect(result.rows.map((row) => row.table_name)).toEqual(expected);
  });

  it("enforces constraints and clears data on reset", async () => {
    const timestamp = new Date("2026-01-01T00:00:00.000Z");
    await connection.db
      .insert(guildModerationSettings)
      .values({ createdAt: timestamp, guildId: "guild-1", updatedAt: timestamp });

    await expect(
      connection.db.insert(guildAutomodRules).values({
        createdAt: timestamp,
        guildId: "guild-1",
        ruleKind: "not-a-rule",
        updatedAt: timestamp,
        updatedBy: "admin-1",
      }),
    ).rejects.toThrow();

    await resetTestDatabase(connection.db);
    await expect(connection.db.select().from(guildModerationSettings)).resolves.toEqual([]);
  });
});
