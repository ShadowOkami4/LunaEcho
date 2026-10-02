import { describe, expect, it } from "vitest";

import { LocalHeuristicSafetyClassifier } from "../../src/modules/moderation/infrastructure/local-heuristic-safety-classifier.js";

describe("LocalHeuristicSafetyClassifier", () => {
  const classifier = new LocalHeuristicSafetyClassifier();

  it("identifies explicit direct threats with high confidence", async () => {
    await expect(classifier.classify("I will kill you")).resolves.toMatchObject({
      confidence: 0.98,
      label: "threat",
      provider: "local-heuristic",
    });
  });

  it("identifies explicit calls for harm against configured identity groups", async () => {
    await expect(classifier.classify("All Muslims should die")).resolves.toMatchObject({
      label: "identity-attack",
    });
  });

  it("does not classify ordinary or quoted-looking discussion as a threat", async () => {
    await expect(
      classifier.classify("This is an ordinary discussion about server rules."),
    ).resolves.toMatchObject({ label: "none" });
  });
});
