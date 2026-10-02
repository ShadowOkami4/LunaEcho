import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { requireManageableGuild } from "@/lib/access";
import { guildIconUrl } from "@/lib/discord";

import { Tabs, type Tab } from "./tabs";

const tabs: readonly Tab[] = [
  { href: "", label: "Modules" },
  { href: "/moderation", label: "Moderation" },
  { href: "/logs", label: "Logs" },
  { href: "/welcome", label: "Welcome" },
  { href: "/roles", label: "Roles" },
  { href: "/tickets", label: "Tickets" },
  { href: "/levels", label: "Levels" },
  { href: "/voice-rooms", label: "Voice Rooms" },
  { href: "/music", label: "Music" },
  { href: "/automation", label: "Automation" },
  { href: "/social", label: "Social" },
];

export default async function GuildLayout({
  children,
  params,
}: Readonly<{ children: ReactNode; params: Promise<{ guildId: string }> }>) {
  const { guildId } = await params;
  const { guild } = await requireManageableGuild(guildId);
  const icon = guildIconUrl(guild);

  return (
    <div className="flex flex-col gap-8">
      <header className="rise flex flex-col gap-6">
        <Link
          href="/servers"
          className="m3-button label inline-flex h-9 w-fit items-center gap-2 bg-surface-low px-4 text-muted hover:bg-surface-high hover:text-on-surface"
        >
          ← All servers
        </Link>
        <div className="flex items-center gap-5">
          <div className="relative grid size-20 shrink-0 place-items-center sm:size-24">
            <div aria-hidden className="shape-morph absolute inset-0 bg-primary/20" />
            {icon === null ? (
              <span className="shape-cookie9 display relative grid size-16 place-items-center bg-secondary-container text-3xl text-on-secondary-container sm:size-20">
                {guild.name.slice(0, 2)}
              </span>
            ) : (
              <Image
                src={icon}
                alt=""
                width={80}
                height={80}
                className="shape-cookie9 relative size-16 sm:size-20"
              />
            )}
          </div>
          <div className="min-w-0">
            <p className="label text-primary">Server settings</p>
            <h1 className="display truncate text-[clamp(2.4rem,6vw,4.4rem)]">{guild.name}</h1>
          </div>
        </div>
        <Tabs guildId={guildId} tabs={tabs} />
      </header>
      {children}
    </div>
  );
}
