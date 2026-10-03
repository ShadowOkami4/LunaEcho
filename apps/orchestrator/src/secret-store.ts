import { randomBytes } from "node:crypto";
import { chown, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** The node user inside the bot image; only it may read a bot's secrets. */
const botUid = 1000;
const botGid = 1000;
const idPattern = /^[0-9a-f-]{36}$/;

export interface SecretStore {
  /** The bot's database password, created once and then reused. */
  databasePassword(botId: string): Promise<string>;
  write(botId: string, files: Readonly<Record<string, string>>): Promise<void>;
  remove(botId: string): Promise<void>;
}

/**
 * Secrets live in one Docker volume, one folder per bot. Each bot container mounts only its own
 * folder, read-only, so a bot cannot see another bot's token.
 */
export class FileSecretStore implements SecretStore {
  public constructor(private readonly root: string) {}

  public async databasePassword(botId: string): Promise<string> {
    const path = join(this.folder(botId), "database-password");

    try {
      return (await readFile(path, "utf8")).trim();
    } catch {
      const password = randomBytes(24).toString("hex");
      await this.write(botId, { "database-password": password });
      return password;
    }
  }

  public async write(botId: string, files: Readonly<Record<string, string>>): Promise<void> {
    const folder = this.folder(botId);
    await mkdir(folder, { mode: 0o700, recursive: true });
    await chown(folder, botUid, botGid);

    for (const [name, content] of Object.entries(files)) {
      const path = join(folder, name);
      await writeFile(path, content, { mode: 0o400 });
      await chown(path, botUid, botGid);
    }
  }

  public async remove(botId: string): Promise<void> {
    await rm(this.folder(botId), { force: true, recursive: true });
  }

  private folder(botId: string): string {
    if (!idPattern.test(botId)) {
      throw new Error(`Refusing unexpected bot id ${JSON.stringify(botId)}`);
    }

    return join(this.root, botId);
  }
}
