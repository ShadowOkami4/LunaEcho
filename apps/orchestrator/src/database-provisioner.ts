import pg from "pg";

/** Only names LunaEcho generates may reach SQL, where identifiers cannot be parameters. */
const databaseNamePattern = /^lunaecho_custom_[0-9a-f]{16}$/;

export interface DatabaseProvisioner {
  /** Creates the database and its login role if needed; returns the bot's connection URL. */
  ensure(name: string, password: string): Promise<string>;
  drop(name: string): Promise<void>;
  close(): Promise<void>;
}

function assertName(name: string): void {
  if (!databaseNamePattern.test(name)) {
    throw new Error(`Refusing unexpected database name ${JSON.stringify(name)}`);
  }
}

/**
 * Gives every Custom bot its own database and its own login role. The role owns only its
 * database, and other roles may not connect to it, so one customer can never read another's data.
 */
export class PostgresProvisioner implements DatabaseProvisioner {
  private readonly pool: pg.Pool;

  public constructor(
    adminUrl: string,
    /** Host and port as the bot containers reach the server, for example custom-postgres:5432. */
    private readonly botHost: string,
  ) {
    this.pool = new pg.Pool({ connectionString: adminUrl, max: 2 });
  }

  public async ensure(name: string, password: string): Promise<string> {
    assertName(name);
    const literal = (value: string) => this.pool.query("SELECT quote_literal($1) AS q", [value]);
    const quotedPassword = ((await literal(password)).rows[0] as { q: string }).q;
    const role = await this.pool.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [name]);

    if (role.rowCount === 0) {
      await this.pool.query(`CREATE ROLE ${name} LOGIN PASSWORD ${quotedPassword}`);
    } else {
      await this.pool.query(`ALTER ROLE ${name} WITH LOGIN PASSWORD ${quotedPassword}`);
    }

    const database = await this.pool.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);

    if (database.rowCount === 0) {
      await this.pool.query(`CREATE DATABASE ${name} OWNER ${name}`);
      await this.pool.query(`REVOKE ALL ON DATABASE ${name} FROM PUBLIC`);
    }

    return `postgres://${name}:${encodeURIComponent(password)}@${this.botHost}/${name}`;
  }

  public async drop(name: string): Promise<void> {
    assertName(name);
    await this.pool.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await this.pool.query(`DROP ROLE IF EXISTS ${name}`);
  }

  public async close(): Promise<void> {
    await this.pool.end();
  }
}
