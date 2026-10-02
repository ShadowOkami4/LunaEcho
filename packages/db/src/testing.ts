import { PGlite } from "@electric-sql/pglite";
import { is, sql } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import {
  resolveMigrationsFolder,
  schema,
  type DatabaseConnection,
  type LunaDatabase,
} from "./database.js";

/**
 * Creates an isolated in-process PostgreSQL database with the real migrations applied, so
 * repository tests run the production SQL without a database server.
 */
export async function createTestDatabase(): Promise<DatabaseConnection> {
  const client = new PGlite();
  const db = drizzle(client, { schema });

  await migrate(db, { migrationsFolder: resolveMigrationsFolder() });

  return {
    close: () => client.close(),
    db,
  };
}

/** Empties every table, which is much faster than creating a database per test. */
export async function resetTestDatabase(db: LunaDatabase): Promise<void> {
  const tables = Object.values(schema).filter((value) => is(value, PgTable));

  await db.execute(sql`TRUNCATE TABLE ${sql.join(tables, sql`, `)} CASCADE`);
}
