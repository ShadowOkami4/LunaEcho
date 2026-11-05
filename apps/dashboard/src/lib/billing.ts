import "server-only";

import { env } from "./env";
import { signHandoff, type BillingAction } from "./handoff";

/**
 * Hands a signed-in user over to the billing service. The public dashboard knows no payment
 * provider: it signs who the user is and what they want, and the separately run billing service
 * (see docs/deployment.md) checks the signature, talks to the provider, and sets the user's
 * Custom slots in the database.
 */
export function billingAvailable(): boolean {
  const { BILLING_HANDOFF_SECRET, BILLING_URL } = env();
  return BILLING_URL !== undefined && BILLING_HANDOFF_SECRET !== undefined;
}

export function billingRedirectUrl(userId: string, action: BillingAction): string | undefined {
  const { BILLING_HANDOFF_SECRET, BILLING_URL } = env();

  if (BILLING_URL === undefined || BILLING_HANDOFF_SECRET === undefined) {
    return undefined;
  }

  const url = new URL(action, BILLING_URL.endsWith("/") ? BILLING_URL : `${BILLING_URL}/`);
  url.searchParams.set("token", signHandoff(userId, action, BILLING_HANDOFF_SECRET));
  return url.toString();
}
