import { describe, expect, it } from "vitest";

import {
  AutomodThresholdInputError,
  createAutomodProfileRules,
  validateAutomodThreshold,
} from "../src/index.js";

describe("AutoMod profiles and thresholds", () => {
  it("provides progressively stronger presets without hiding their settings", () => {
    const relaxed = createAutomodProfileRules("relaxed");
    const balanced = createAutomodProfileRules("balanced");
    const strict = createAutomodProfileRules("strict");

    expect(relaxed.filter((rule) => rule.enabled)).toHaveLength(6);
    expect(balanced.filter((rule) => rule.enabled)).toHaveLength(7);
    expect(strict.filter((rule) => rule.enabled)).toHaveLength(10);
    expect(strict.find((rule) => rule.kind === "message-flood")).toMatchObject({
      action: "delete-and-timeout",
      threshold: { triggerLimit: 4, windowSeconds: 6 },
      timeoutSeconds: 1_800,
    });
  });

  it("rejects thresholds outside the safe rule-specific bounds", () => {
    expect(() =>
      validateAutomodThreshold("mention-spam", {
        secondaryLimit: null,
        triggerLimit: 1,
        windowSeconds: null,
      }),
    ).toThrow(AutomodThresholdInputError);
    expect(
      validateAutomodThreshold("cross-channel-spam", {
        secondaryLimit: 4,
        triggerLimit: 6,
        windowSeconds: 20,
      }),
    ).toMatchObject({ secondaryLimit: 4, triggerLimit: 6, windowSeconds: 20 });
  });
});
