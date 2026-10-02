import Image from "next/image";
import Link from "next/link";

import { Icon } from "@/components/icon";
import { listManageableGuilds, requireSession } from "@/lib/access";
import { guildIconUrl, inviteUrl } from "@/lib/discord";
import { delay } from "@/lib/motion";

import { buttonClass, Chip } from "./[guildId]/ui";

export const dynamic = "force-dynamic";

export default async function ServersPage() {
  const session = await requireSession();
  const guilds = await listManageableGuilds(session);
  const ready = guilds.filter((guild) => guild.botPresent).length;

  return (
    <section className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="headline-large">Servers</h1>
        <p className="text-muted">
          Servers where you have the Manage Server permission. LunaEcho is active in {ready} of{" "}
          {guilds.length}.
        </p>
      </header>

      {guilds.length === 0 ? (
        <div className="m3-card flex flex-col items-center gap-3 border border-outline/50 bg-surface-low p-10 text-center">
          <Icon name="dns" className="size-10 text-faint" />
          <p className="title-medium">No servers to manage</p>
          <p className="max-w-md text-sm text-muted">
            You need the Manage Server permission in a Discord server to configure LunaEcho there.
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {guilds.map((guild, index) => {
            const icon = guildIconUrl(guild);

            return (
              <li
                key={guild.id}
                style={delay(Math.min(index, 8) * 40)}
                className="m3-card m3-card-interactive rise flex flex-col gap-5 border border-outline/50 bg-surface-low p-5"
              >
                <div className="flex items-center gap-4">
                  {icon === null ? (
                    <span className="shape-cookie9 grid size-14 shrink-0 place-items-center bg-secondary-container text-lg font-semibold text-on-secondary-container">
                      {guild.name.slice(0, 2)}
                    </span>
                  ) : (
                    <Image
                      src={icon}
                      alt=""
                      width={56}
                      height={56}
                      className="shape-cookie9 size-14 shrink-0"
                    />
                  )}
                  <div className="min-w-0">
                    <h2 className="title-medium truncate">{guild.name}</h2>
                    <div className="mt-1">
                      {guild.botPresent ? (
                        <Chip tone="success" icon="checkCircle">
                          Active
                        </Chip>
                      ) : (
                        <Chip>Not added</Chip>
                      )}
                    </div>
                  </div>
                </div>
                <div className="mt-auto flex justify-end">
                  {guild.botPresent ? (
                    <Link href={`/servers/${guild.id}`} className={buttonClass("neutral")}>
                      <Icon name="settings" className="-ml-1 size-[18px]" />
                      Configure
                    </Link>
                  ) : (
                    <a href={inviteUrl(guild.id)} className={buttonClass("outlined")}>
                      <Icon name="groupAdd" className="-ml-1 size-[18px]" />
                      Add LunaEcho
                    </a>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
