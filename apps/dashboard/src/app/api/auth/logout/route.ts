import { NextResponse, type NextRequest } from "next/server";

import { getSession } from "@/lib/session";

/** POST only, so a link or image on another site cannot sign anyone out. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getSession();
  session.destroy();
  // 303 turns the form POST into a GET of the home page.
  return NextResponse.redirect(new URL("/", request.url), 303);
}
