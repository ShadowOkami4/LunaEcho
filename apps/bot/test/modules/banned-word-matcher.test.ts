import { describe, expect, it } from "vitest";

import { BannedWordMatcher } from "../../src/modules/moderation/domain/banned-word-matcher.js";
import type { BannedWord } from "@lunaecho/modules";

function bannedWord(normalizedValue: string): BannedWord {
  return {
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    createdBy: "admin-1",
    displayValue: normalizedValue,
    normalizedValue,
  };
}

describe("BannedWordMatcher", () => {
  const matcher = new BannedWordMatcher();

  it.each([
    ["This contains BAD WORD!", "bad word"],
    ["A full-width ＢＡＤ word", "bad"],
    ["Do you use c++?", "c++"],
    ["bad\nword", "bad word"],
  ])("matches %j against %j", (content, configuredWord) => {
    expect(matcher.findMatch(content, [bannedWord(configuredWord)])).toBeDefined();
  });

  it.each([
    ["A harmless class name", "ass"],
    ["This is a badger", "bad"],
    ["notbad word suffix", "bad word"],
  ])("does not match %j against %j inside a larger word", (content, configuredWord) => {
    expect(matcher.findMatch(content, [bannedWord(configuredWord)])).toBeUndefined();
  });
});
