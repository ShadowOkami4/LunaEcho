import { describe, expect, it } from "vitest";

import { signHandoff, verifyHandoff } from "../src/lib/handoff";

const secret = "a-test-secret-that-is-long-enough-for-hmac";
const user = "123456789012345678";
const now = new Date("2026-11-05T12:00:00Z");

describe("billing handoff", () => {
  it("round-trips the user and action within its lifetime", () => {
    const token = signHandoff(user, "checkout", secret, now);

    expect(verifyHandoff(token, secret, now)).toMatchObject({ action: "checkout", userId: user });
    expect(verifyHandoff(token, secret, new Date(now.getTime() + 299_000))).toBeDefined();
  });

  it("refuses expired, tampered, and wrongly signed tokens", () => {
    const token = signHandoff(user, "portal", secret, now);
    const [payload, signature] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ action: "portal", expires: 9_999_999_999, userId: "999999999999999999" }),
    ).toString("base64url");

    expect(verifyHandoff(token, secret, new Date(now.getTime() + 301_000))).toBeUndefined();
    expect(verifyHandoff(`${forged}.${signature ?? ""}`, secret, now)).toBeUndefined();
    expect(
      verifyHandoff(`${payload ?? ""}.${signature ?? ""}`, "another-secret", now),
    ).toBeUndefined();
    expect(verifyHandoff("not-a-token", secret, now)).toBeUndefined();
  });
});
