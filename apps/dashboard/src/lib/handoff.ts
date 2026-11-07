import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type BillingAction = "checkout" | "portal" | "slots";

/** The most Custom bots one customer can pay for. */
export const maximumBillingSlots = 10;

export type Handoff = Readonly<{
  action: BillingAction;
  expires: number;
  /** Only for "slots": how many bots the customer wants to pay for. */
  slots?: number;
  userId: string;
}>;

/** A handoff link is only good for a few minutes. */
const lifetimeSeconds = 300;

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/**
 * `<payload>.<signature>`, both base64url. The payload is JSON with the action, the Discord user,
 * an expiry in Unix seconds, a nonce, and for "slots" the number of bots (1 to 10); the signature
 * is HMAC-SHA256 with the shared secret.
 */
export function signHandoff(
  userId: string,
  action: BillingAction,
  secret: string,
  now: Date = new Date(),
  slots?: number,
): string {
  const payload = Buffer.from(
    JSON.stringify({
      action,
      expires: Math.floor(now.getTime() / 1000) + lifetimeSeconds,
      nonce: randomBytes(9).toString("base64url"),
      userId,
      ...(slots === undefined ? {} : { slots }),
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

  const { action, expires, slots, userId } = data;

  if (
    (action !== "checkout" && action !== "portal" && action !== "slots") ||
    (action === "slots" &&
      (typeof slots !== "number" ||
        !Number.isInteger(slots) ||
        slots < 1 ||
        slots > maximumBillingSlots)) ||
    typeof userId !== "string" ||
    !/^\d{17,20}$/.test(userId) ||
    typeof expires !== "number" ||
    expires <= now.getTime() / 1000
  ) {
    return undefined;
  }

  return action === "slots" && typeof slots === "number"
    ? { action, expires, slots, userId }
    : { action, expires, userId };
}
