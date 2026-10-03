import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { TokenVault, TokenVaultError } from "../src/index.js";

const token = "MTIzNDU2Nzg5MDEyMzQ1Njc4.Gabcde.not-a-real-token-but-shaped-like-one";

describe("TokenVault", () => {
  it("seals and opens a token for the same bot", () => {
    const vault = new TokenVault(randomBytes(32));
    const sealed = vault.seal(token, "bot-1");

    expect(sealed).toMatch(/^v1:/);
    expect(sealed).not.toContain(token);
    expect(vault.open(sealed, "bot-1")).toBe(token);
  });

  it("produces a different ciphertext every time", () => {
    const vault = new TokenVault(randomBytes(32));

    expect(vault.seal(token, "bot-1")).not.toBe(vault.seal(token, "bot-1"));
  });

  it("refuses another bot's id, another key, and tampered values", () => {
    const vault = new TokenVault(randomBytes(32));
    const sealed = vault.seal(token, "bot-1");
    const tampered = `${sealed.slice(0, -4)}AAAA`;

    expect(() => vault.open(sealed, "bot-2")).toThrow(TokenVaultError);
    expect(() => new TokenVault(randomBytes(32)).open(sealed, "bot-1")).toThrow(TokenVaultError);
    expect(() => vault.open(tampered, "bot-1")).toThrow(TokenVaultError);
    expect(() => vault.open("v0:abc", "bot-1")).toThrow(TokenVaultError);
  });

  it("only accepts 32-byte keys", () => {
    expect(() => new TokenVault(randomBytes(16))).toThrow(TokenVaultError);
  });
});
