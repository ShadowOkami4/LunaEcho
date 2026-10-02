import { describe, expect, it } from "vitest";

import { LogMessageCache } from "../../src/modules/logs/log-message-cache.js";
import { quote } from "../../src/modules/logs/log-sender.js";

describe("LogMessageCache", () => {
  it("remembers, updates, and forgets messages, cutting long texts", () => {
    const cache = new LogMessageCache();
    const base = {
      attachments: 0,
      authorId: "alice",
      channelId: "general",
      createdAt: new Date(),
      guildId: "guild-1",
    };

    cache.remember("message-1", { ...base, content: "x".repeat(5_000) });

    expect(cache.get("message-1")?.content).toHaveLength(1_000);
    expect(cache.forget("message-1")?.authorId).toBe("alice");
    expect(cache.get("message-1")).toBeUndefined();
  });
});

describe("quote", () => {
  it("quotes every line and shortens long text", () => {
    expect(quote("one\ntwo")).toBe("> one\n> two");
    expect(quote("abcdef", 3)).toBe("> abc…");
    expect(quote("")).toBe("-# (no text)");
  });
});
