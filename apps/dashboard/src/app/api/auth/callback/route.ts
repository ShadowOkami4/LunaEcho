import { timingSafeEqual } from "node:crypto";

import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";

import { exchangeCode, fetchCurrentUser } from "@/lib/discord";
import { getSession } from "@/lib/session";

function sameState(expected: string | undefined, received: string | null): boolean {
  if (expected === undefined || received === null) {
    return false;
  }

  // timingSafeEqual needs equal lengths; the length itself reveals nothing secret.
  if (expected.length !== received.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}

export async function GET(request: NextRequest): Promise<never> {
  const session = await getSession();
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const expectedState = session.oauthState;

  session.oauthState = undefined;

  if (code === null || !sameState(expectedState, state)) {
    await session.save();
    redirect("/?error=login");
  }

  let token: Awaited<ReturnType<typeof exchangeCode>>;
  let user: Awaited<ReturnType<typeof fetchCurrentUser>>;

  try {
    token = await exchangeCode(code);
    user = await fetchCurrentUser(token.accessToken);
  } catch {
    await session.save();
    redirect("/?error=login");
  }

  session.accessToken = token.accessToken;
  session.expiresAt = token.expiresAt;
  session.user = {
    avatar: user.avatar,
    globalName: user.global_name,
    id: user.id,
    username: user.username,
  };
  await session.save();
  redirect("/servers");
}
