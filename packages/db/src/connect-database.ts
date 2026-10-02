import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

import { resolveMigrationsFolder, schema, type DatabaseConnection } from "./database.js";

export type ConnectDatabaseOptions = Readonly<{
  connectionString: string;
  /** Called when an idle pooled connection fails, which must not crash the process. */
  onPoolError?: (error: Error) => void;
  /** Connections kept open at most; the dashboard needs far fewer than the bot. */
  poolSize?: number;
  /**
   * Whether to apply pending migrations first (default true). The dashboard skips this: the bot
   * or `npm run db:migrate` owns the schema, and bundled code cannot locate the SQL files.
   */
  runMigrations?: boolean;
}>;

/** Arbitrary but fixed key; every LunaEcho process takes this lock before migrating. */
const migrationLockKey = 726_353_001;

/**
 * Opens the PostgreSQL pool and applies every pending migration before returning. The bot and
 * the dashboard both call this, so migrations run under an advisory lock: whichever process
 * starts second waits and then finds nothing left to do.
 */
export async function connectDatabase(
  options: ConnectDatabaseOptions,
): Promise<DatabaseConnection> {
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    max: options.poolSize ?? 10,
  });

  pool.on("error", (error) => {
    options.onPoolError?.(error);
  });

  const db = drizzle(pool, { schema });

  if (options.runMigrations === false) {
    return { close: () => pool.end(), db };
  }

  try {
    const lockClient = await pool.connect();

    try {
      await lockClient.query("SELECT pg_advisory_lock($1)", [migrationLockKey]);
      await migrate(db, { migrationsFolder: resolveMigrationsFolder() });
    } finally {
      await lockClient.query("SELECT pg_advisory_unlock($1)", [migrationLockKey]).catch(() => {
        // The lock ends with the session anyway once the connection is released.
      });
      lockClient.release();
    }
  } catch (error) {
    await pool.end();
    throw error;
  }

  return {
    close: () => pool.end(),
    db,
  };
}
