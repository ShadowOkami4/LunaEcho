import { randomBytes } from "node:crypto";

import { redirect } from "next/navigation";

import { authorizeUrl } from "@/lib/discord";
import { getSession } from "@/lib/session";

/** Starts the Discord login; the random state protects the callback against forged logins. */
export async function GET(): Promise<never> {
  const session = await getSession();
  const state = randomBytes(24).toString("base64url");
  session.oauthState = state;
  await session.save();
  redirect(authorizeUrl(state));
}
