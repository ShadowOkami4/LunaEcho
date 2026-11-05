import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type BillingAction = "checkout" | "portal";

export type Handoff = Readonly<{ action: BillingAction; expires: number; userId: string }>;

/** A handoff link is only good for a few minutes. */
const lifetimeSeconds = 300;

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/**
 * `<payload>.<signature>`, both base64url. The payload is JSON with the action, the Discord user,
 * and an expiry in Unix seconds; the signature is HMAC-SHA256 with the shared secret.
 */
export function signHandoff(
  userId: string,
  action: BillingAction,
  secret: string,
  now: Date = new Date(),
): string {
  const payload = Buffer.from(
    JSON.stringify({
      action,
      expires: Math.floor(now.getTime() / 1000) + lifetimeSeconds,
      nonce: randomBytes(9).toString("base64url"),
      userId,
    }),
  ).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

/**
 * The receiving side's check, kept here as the reference the billing service mirrors and the
 * tests exercise. Returns undefined for a wrong signature, an expired token, or bad content.
 */
export function verifyHandoff(
  token: string,
  secret: string,
  now: Date = new Date(),
): Handoff | undefined {
  const [payload, signature, extra] = token.split(".");

  if (payload === undefined || signature === undefined || extra !== undefined) {
    return undefined;
  }

  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(signature);

  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return undefined;
  }

  let data: Partial<Record<keyof Handoff, unknown>>;

  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as typeof data;
  } catch {
    return undefined;
  }

  const { action, expires, userId } = data;

  if (
    (action !== "checkout" && action !== "portal") ||
    typeof userId !== "string" ||
    !/^\d{17,20}$/.test(userId) ||
    typeof expires !== "number" ||
    expires <= now.getTime() / 1000
  ) {
    return undefined;
  }

  return { action, expires, userId };
}
