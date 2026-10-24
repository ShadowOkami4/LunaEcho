import type { Metadata, Viewport } from "next";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { Icon } from "@/components/icon";
import { userAvatarUrl } from "@/lib/discord";
import { getActiveSession } from "@/lib/session";

import "./globals.css";

/** Every page depends on the signed-in user, so nothing is rendered at build time. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  description: "Configure LunaEcho for your Discord servers.",
  title: "LunaEcho Dashboard",
};

export const viewport: Viewport = { themeColor: "#080506" };

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const session = await getActiveSession();
  const avatar = session === undefined ? null : userAvatarUrl(session.user);

  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col">
        {/* M3 small top app bar, as a floating glass pill. */}
        <header className="app-bar sticky top-3.5 z-40 mx-auto mt-3.5 w-[min(80rem,calc(100%-1.5rem))] rounded-full">
          <div className="flex h-15 items-center justify-between gap-4 px-2 py-1.5">
            <Link
              href={session === undefined ? "/" : "/servers"}
              className="flex items-center gap-3 rounded-full py-1 pr-3"
            >
              <span className="shape-cookie12 grid size-10 place-items-center bg-surface-high">
                <Image src="/lunaecho-logo.png" alt="" width={30} height={25} priority />
              </span>
              <span className="display text-2xl">
                Luna<span className="text-tertiary">Echo</span>
              </span>
              <span className="hidden rounded-full bg-on-surface/6 px-2.5 py-0.5 text-xs font-medium text-muted sm:inline">
                Dashboard
              </span>
            </Link>
            {session !== undefined && (
              <div className="flex items-center gap-2">
                <span className="hidden items-center gap-2.5 sm:flex">
                  {avatar !== null && (
                    <Image
                      src={avatar}
                      alt=""
                      width={32}
                      height={32}
                      className="size-8 rounded-full"
                    />
                  )}
                  <span className="text-sm font-medium">
                    {session.user.globalName ?? session.user.username}
                  </span>
                </span>
                <form action="/api/auth/logout" method="post">
                  <button
                    aria-label="Sign out"
                    title="Sign out"
                    className="m3-button grid size-10 place-items-center text-muted hover:bg-surface-high hover:text-on-surface"
                  >
                    <Icon name="logout" className="size-5" />
                  </button>
                </form>
              </div>
            )}
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">{children}</main>

        <footer className="border-t border-white/6">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs text-faint sm:px-6">
            <span>© 2026 ShadowOkami · LunaEcho is open source under AGPL-3.0</span>
            <nav aria-label="Legal" className="flex gap-5">
              <a href="https://shadowokami.com/LunaEcho" className="hover:text-on-surface">
                About
              </a>
              <a href="https://shadowokami.com/LunaEcho/Privacy" className="hover:text-on-surface">
                Privacy
              </a>
              <a href="https://shadowokami.com/LunaEcho/Terms" className="hover:text-on-surface">
                Terms
              </a>
            </nav>
          </div>
        </footer>
      </body>
    </html>
  );
}
