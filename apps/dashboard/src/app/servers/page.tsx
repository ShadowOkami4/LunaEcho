import Image from "next/image";
import Link from "next/link";

import { listManageableGuilds, requireSession } from "@/lib/access";
import { guildIconUrl, inviteUrl } from "@/lib/discord";
import { delay } from "@/lib/motion";

export const dynamic = "force-dynamic";

export default async function ServersPage() {
  const session = await requireSession();
  const guilds = await listManageableGuilds(session);
  const ready = guilds.filter((guild) => guild.botPresent).length;

  return (
    <section className="flex flex-col gap-10">
      <header className="rise flex flex-col gap-4">
        <p className="label inline-flex items-center gap-3 text-primary">
          <span className="shape-cookie6 grid size-9 place-items-center bg-primary-container text-on-primary-container">
            01
          </span>
          Your servers
        </p>
        <h1 className="display text-[clamp(2.8rem,6vw,5rem)]">
          Pick a server.
          <br />
          <span className="text-muted">Tune what it needs.</span>
        </h1>
        <p className="max-w-2xl text-muted">
          Servers where you have the Manage Server permission. LunaEcho runs in {ready} of{" "}
          {guilds.length}.
        </p>
      </header>

      {guilds.length === 0 ? (
        <p className="m3-card bg-surface p-8 text-muted">
          You do not have the Manage Server permission in any server.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {guilds.map((guild, index) => {
            const icon = guildIconUrl(guild);
            const card = (
              <>
                <div className="flex items-start justify-between gap-3">
                  {icon === null ? (
                    <span className="shape-cookie9 display grid size-16 place-items-center bg-secondary-container text-2xl text-on-secondary-container">
                      {guild.name.slice(0, 2)}
                    </span>
                  ) : (
                    <Image
                      src={icon}
                      alt=""
                      width={64}
                      height={64}
                      className="shape-cookie9 size-16"
                    />
                  )}
                  <span
                    className={`label rounded-full px-3 py-1.5 ${
                      guild.botPresent
                        ? "bg-secondary-container text-on-secondary-container"
                        : "bg-tertiary/15 text-tertiary"
                    }`}
                  >
                    {guild.botPresent ? "Active" : "Not added"}
                  </span>
                </div>
                <div className="mt-auto">
                  <h2 className="display truncate text-[1.9rem]">{guild.name}</h2>
                  <p className="mt-1 text-sm text-muted">
                    {guild.botPresent ? "Open settings →" : "Add LunaEcho to this server →"}
                  </p>
                </div>
              </>
            );
            const className = "m3-card m3-card-interactive rise flex min-h-52 flex-col gap-6 p-6";

            return (
              <li key={guild.id} style={delay(Math.min(index, 8) * 50)} className="contents">
                {guild.botPresent ? (
                  <Link href={`/servers/${guild.id}`} className={`${className} bg-surface`}>
                    {card}
                  </Link>
                ) : (
                  <a
                    href={inviteUrl(guild.id)}
                    className={`${className} bg-[color-mix(in_srgb,var(--color-tertiary)_6%,var(--color-surface))]`}
                  >
                    {card}
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
