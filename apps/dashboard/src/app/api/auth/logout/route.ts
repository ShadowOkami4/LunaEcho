import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { getSession } from "@/lib/session";

/** POST only, so a link or image on another site cannot sign anyone out. */
export async function POST(): Promise<NextResponse> {
  const session = await getSession();
  session.destroy();
  // 303 turns the form POST into a GET of the home page. Behind a reverse proxy the request URL
  // is the container's own address (localhost), so the public address comes from configuration.
  return NextResponse.redirect(new URL("/", env().DASHBOARD_URL), 303);
}
