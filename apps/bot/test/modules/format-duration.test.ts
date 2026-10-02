import { describe, expect, it } from "vitest";

import { formatDuration } from "../../src/modules/system/format-duration.js";

describe("formatDuration", () => {
  it.each([
    [-1, "0m"],
    [59, "0m"],
    [3_661, "1h 1m"],
    [90_061, "1d 1h 1m"],
  ])("formats %s seconds as %s", (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });
});
