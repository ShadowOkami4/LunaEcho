import "server-only";

import { getIronSession, type IronSession } from "iron-session";
import { cookies } from "next/headers";

import { env } from "./env";

export type SessionUser = Readonly<{
  avatar: string | null;
  globalName: string | null;
  id: string;
  username: string;
}>;

export interface SessionData {
  /** Discord OAuth access token; the cookie is encrypted, so the browser never sees it. */
  accessToken?: string | undefined;
  expiresAt?: number | undefined;
  oauthState?: string | undefined;
  user?: SessionUser | undefined;
}

export async function getSession(): Promise<IronSession<SessionData>> {
  const environment = env();

  return getIronSession<SessionData>(await cookies(), {
    cookieName: "lunaecho_session",
    cookieOptions: {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: environment.NODE_ENV === "production",
    },
    password: environment.SESSION_SECRET,
    ttl: 60 * 60 * 24 * 7,
  });
}

export type ActiveSession = Readonly<{ accessToken: string; user: SessionUser }>;

/** The signed-in user, or undefined when not signed in or the Discord token expired. */
export async function getActiveSession(): Promise<ActiveSession | undefined> {
  const session = await getSession();

  if (
    session.user === undefined ||
    session.accessToken === undefined ||
    (session.expiresAt ?? 0) <= Date.now()
  ) {
    return undefined;
  }

  return { accessToken: session.accessToken, user: session.user };
}
