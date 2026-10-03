import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

const algorithm = "aes-256-gcm";
const ivBytes = 12;
const tagBytes = 16;
/** Bumped when the format or key changes, so old values can still be told apart. */
const formatVersion = "v1";

export class TokenVaultError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "TokenVaultError";
  }
}

/**
 * Seals customers' bot tokens with AES-256-GCM. The key lives in a file outside the database, so
 * a leaked database reveals no token. Each sealed token is bound to its bot's id: a sealed value
 * copied onto another bot's row does not open.
 */
export class TokenVault {
  private readonly key: Buffer;

  public constructor(key: Uint8Array) {
    if (key.byteLength !== 32) {
      throw new TokenVaultError("The token key must be exactly 32 bytes.");
    }

    this.key = Buffer.from(key);
  }

  /** Reads a base64 key file, as created with `openssl rand -base64 32`. */
  public static fromKeyFile(path: string): TokenVault {
    let content: string;

    try {
      content = readFileSync(path, "utf8").trim();
    } catch {
      throw new TokenVaultError("The token key file cannot be read.");
    }

    return new TokenVault(Buffer.from(content, "base64"));
  }

  public seal(token: string, botId: string): string {
    const iv = randomBytes(ivBytes);
    const cipher = createCipheriv(algorithm, this.key, iv, { authTagLength: tagBytes });
    cipher.setAAD(Buffer.from(botId, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
    const payload = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
    return `${formatVersion}:${payload.toString("base64")}`;
  }

  public open(sealed: string, botId: string): string {
    const [version, encoded] = sealed.split(":");

    if (version !== formatVersion || encoded === undefined) {
      throw new TokenVaultError("Unknown sealed token format.");
    }

    const payload = Buffer.from(encoded, "base64");

    if (payload.byteLength <= ivBytes + tagBytes) {
      throw new TokenVaultError("The sealed token is too short.");
    }

    try {
      const decipher = createDecipheriv(algorithm, this.key, payload.subarray(0, ivBytes), {
        authTagLength: tagBytes,
      });
      decipher.setAAD(Buffer.from(botId, "utf8"));
      decipher.setAuthTag(payload.subarray(ivBytes, ivBytes + tagBytes));
      return Buffer.concat([
        decipher.update(payload.subarray(ivBytes + tagBytes)),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      // Never say why: wrong key, wrong bot, and tampering all look the same from outside.
      throw new TokenVaultError("The sealed token cannot be opened.");
    }
  }
}
