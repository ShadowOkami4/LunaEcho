import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import * as schema from "./schema.js";

/** Driver-independent handle, so repositories work against PostgreSQL and the test database. */
export type LunaDatabase = PgDatabase<PgQueryResultHKT, typeof schema>;

export type DatabaseConnection = Readonly<{
  close(): Promise<void>;
  db: LunaDatabase;
}>;

/**
 * The generated SQL migrations live beside both `src` and the compiled `dist` directory. Built
 * with path functions rather than `new URL("../drizzle", import.meta.url)`, which bundlers such
 * as Turbopack would try to resolve as an asset.
 */
export function resolveMigrationsFolder(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "drizzle");
}

export { schema };
