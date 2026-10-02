"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type Tab = Readonly<{ href: string; label: string }>;

/**
 * M3 Expressive navigation chips. The selected one fills with the secondary container and squares
 * its corners slightly, the way connected button groups mark their selection.
 */
export function Tabs({ guildId, tabs }: Readonly<{ guildId: string; tabs: readonly Tab[] }>) {
  const pathname = usePathname();
  const base = `/servers/${guildId}`;

  return (
    <nav
      aria-label="Server settings"
      className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0"
    >
      {tabs.map((tab) => {
        const href = `${base}${tab.href}`;
        const selected = pathname === href;

        return (
          <Link
            key={tab.label}
            href={href}
            aria-current={selected ? "page" : undefined}
            className={`m3-button inline-flex h-10 shrink-0 items-center px-4 text-sm font-semibold ${
              selected
                ? "bg-secondary-container text-on-secondary-container"
                : "bg-surface-low text-muted hover:bg-surface-high hover:text-on-surface"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
