import { describe, expect, it } from "vitest";

import { BannedWordInputError } from "../src/index.js";
import { createTestModerationService } from "../src/testing.js";

describe("ModerationSettingsService", () => {
  it("normalizes and stores banned words per guild", async () => {
    const service = createTestModerationService();

    await expect(service.addBannedWord("guild-1", "  Bad   Phrase  ", "admin-1")).resolves.toEqual({
      displayValue: "Bad Phrase",
      status: "added",
    });
    await expect(service.addBannedWord("guild-1", "bad phrase", "admin-2")).resolves.toEqual({
      displayValue: "bad phrase",
      status: "already-exists",
    });

    const settings = await service.getSettings("guild-1");
    expect(settings.bannedWords).toHaveLength(1);
    expect(settings.bannedWords[0]).toMatchObject({
      createdBy: "admin-1",
      displayValue: "Bad Phrase",
      normalizedValue: "bad phrase",
    });
    await expect(service.getSettings("guild-2")).resolves.toMatchObject({ bannedWords: [] });
  });

  it("removes entries case-insensitively and reports missing entries", async () => {
    const service = createTestModerationService();
    await service.addBannedWord("guild-1", "Unwanted", "admin-1");

    await expect(service.removeBannedWord("guild-1", "UNWANTED")).resolves.toEqual({
      displayValue: "UNWANTED",
      status: "removed",
    });
    await expect(service.removeBannedWord("guild-1", "Unwanted")).resolves.toEqual({
      displayValue: "Unwanted",
      status: "not-found",
    });
  });

  it("toggles the filter state", async () => {
    const service = createTestModerationService();

    await expect(service.toggleBannedWords("guild-1")).resolves.toBe(true);
    await expect(service.toggleBannedWords("guild-1")).resolves.toBe(false);
  });

  it("applies presets and supports focused custom configuration", async () => {
    const service = createTestModerationService();

    await service.applyAutomodProfile("guild-1", "balanced", "admin-1");
    await expect(service.getSettings("guild-1")).resolves.toMatchObject({
      automodProfile: "balanced",
    });
    const updated = await service.setAutomodRuleThreshold(
      "guild-1",
      "mention-spam",
      { secondaryLimit: null, triggerLimit: 7, windowSeconds: null },
      "admin-1",
    );
    expect(updated.threshold.triggerLimit).toBe(7);
    await expect(service.getSettings("guild-1")).resolves.toMatchObject({
      automodProfile: "custom",
    });
  });

  it("toggles channel and role exceptions independently", async () => {
    const service = createTestModerationService();

    await expect(service.toggleExemptChannel("guild-1", "channel-1", "admin-1")).resolves.toBe(
      "added",
    );
    await expect(service.toggleExemptRole("guild-1", "role-1", "admin-1")).resolves.toBe("added");
    await expect(service.getSettings("guild-1")).resolves.toMatchObject({
      exemptChannelIds: ["channel-1"],
      exemptRoleIds: ["role-1"],
    });
    await expect(service.toggleExemptChannel("guild-1", "channel-1", "admin-1")).resolves.toBe(
      "removed",
    );
  });

  it.each(["", "a", "\u200bhidden", "line\nbreak"])("rejects unsafe input %j", async (input) => {
    const service = createTestModerationService();

    await expect(service.addBannedWord("guild-1", input, "admin-1")).rejects.toBeInstanceOf(
      BannedWordInputError,
    );
  });
});
