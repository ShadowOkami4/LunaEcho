import type { BannedWord } from "@lunaecho/modules";

const regexCharacters = /[.*+?^${}()|[\]\\]/gu;
const maximumCachedPatterns = 2_000;

function normalizeMessageContent(content: string): string {
  return content.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ");
}

function createPattern(value: string): RegExp {
  const escapedValue = value.replace(regexCharacters, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escapedValue}(?![\\p{L}\\p{N}_])`, "u");
}

export class BannedWordMatcher {
  private readonly patterns = new Map<string, RegExp>();

  public findMatch(content: string, bannedWords: readonly BannedWord[]): BannedWord | undefined {
    const normalizedContent = normalizeMessageContent(content);

    for (const bannedWord of bannedWords) {
      if (this.getPattern(bannedWord.normalizedValue).test(normalizedContent)) {
        return bannedWord;
      }
    }

    return undefined;
  }

  private getPattern(value: string): RegExp {
    const cachedPattern = this.patterns.get(value);

    if (cachedPattern !== undefined) {
      return cachedPattern;
    }

    if (this.patterns.size >= maximumCachedPatterns) {
      const oldestKey = this.patterns.keys().next().value;

      if (typeof oldestKey === "string") {
        this.patterns.delete(oldestKey);
      }
    }

    const pattern = createPattern(value);
    this.patterns.set(value, pattern);
    return pattern;
  }
}
