import type { Metadata, Viewport } from "next";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { userAvatarUrl } from "@/lib/discord";
import { getActiveSession } from "@/lib/session";

import "./globals.css";

/** Every page depends on the signed-in user, so nothing is rendered at build time. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  description: "Configure LunaEcho for your Discord servers.",
  title: "LunaEcho Dashboard",
};

export const viewport: Viewport = { themeColor: "#140c10" };

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const session = await getActiveSession();
  const avatar = session === undefined ? null : userAvatarUrl(session.user);

  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col">
        <div className="site-grid" aria-hidden />

        {/* A floating M3 toolbar, as on the product page. */}
        <header className="sticky top-0 z-40 px-3 pt-3 sm:px-6 sm:pt-4">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 rounded-full bg-surface-low/85 py-2 pr-2 pl-3 shadow-[0_12px_32px_rgb(0_0_0/0.28)] backdrop-blur-xl">
            <Link
              href={session === undefined ? "/" : "/servers"}
              className="m3-button flex items-center gap-3 py-1 pr-3 pl-1 hover:bg-surface-high"
            >
              <span className="shape-cookie12 grid size-11 place-items-center bg-surface-highest">
                <Image src="/lunaecho-logo.png" alt="" width={34} height={28} priority />
              </span>
              <span className="flex flex-col leading-none">
                <strong className="display text-2xl tracking-wide uppercase">
                  Luna<span className="outline-text">Echo</span>
                </strong>
                <small className="label mt-1 text-faint">Dashboard · Pre-release</small>
              </span>
            </Link>
            {session !== undefined && (
              <div className="flex items-center gap-2">
                <span className="hidden items-center gap-2 rounded-full bg-surface-high py-1 pr-4 pl-1 sm:flex">
                  {avatar !== null && (
                    <Image
                      src={avatar}
                      alt=""
                      width={32}
                      height={32}
                      className="shape-cookie9 size-8"
                    />
                  )}
                  <span className="text-sm font-medium">
                    {session.user.globalName ?? session.user.username}
                  </span>
                </span>
                <form action="/api/auth/logout" method="post">
                  <button className="m3-button h-10 bg-secondary-container px-4 text-sm font-semibold text-on-secondary-container hover:bg-secondary-container/80">
                    Sign out
                  </button>
                </form>
              </div>
            )}
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
          {children}
        </main>

        <footer className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 pb-8 text-xs text-faint sm:px-6">
          <span className="label">© 2026 ShadowOkami · AGPL-3.0</span>
          <span className="flex gap-4">
            <a href="https://shadowokami.com/LunaEcho" className="hover:text-primary">
              About LunaEcho
            </a>
            <a href="https://shadowokami.com/LunaEcho/Privacy" className="hover:text-primary">
              Privacy
            </a>
            <a href="https://shadowokami.com/LunaEcho/Terms" className="hover:text-primary">
              Terms
            </a>
          </span>
        </footer>
      </body>
    </html>
  );
}
