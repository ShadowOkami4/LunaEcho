import Image from "next/image";
import Link from "next/link";

import { Icon } from "@/components/icon";
import { listManageableGuilds } from "@/lib/access";
import { customBotInviteUrl, guildIconUrl } from "@/lib/discord";
import { delay } from "@/lib/motion";
import { requireCustomBot } from "@/lib/workspace";

import { buttonClass, Chip } from "../../servers/[guildId]/ui";

export const dynamic = "force-dynamic";

/**
 * One Custom bot's servers: where the signed-in owner may manage the server, with the bot's own
 * settings for each. LunaEcho's settings in the same server stay separate, under /servers.
 */
export default async function CustomBotServersPage({
  params,
}: Readonly<{ params: Promise<{ botId: string }> }>) {
  const { botId } = await params;
  const { bot, identity, session } = await requireCustomBot(botId);
  const guilds = await listManageableGuilds(session, identity);
  const ready = guilds.filter((guild) => guild.botPresent).length;

  return (
    <section className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <Link
          href="/bots"
          className="inline-flex items-center gap-1 self-start text-sm text-muted hover:text-on-surface"
        >
          <Icon name="chevronRight" className="size-4 rotate-180" />
          Custom bots
        </Link>
        <h1 className="headline-large">{bot.name}</h1>
        <p className="text-muted">
          Servers where you have the Manage Server permission. {bot.name} is in {ready} of{" "}
          {guilds.length}. Its settings are its own, separate from LunaEcho's.
        </p>
      </header>

      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {guilds.map((guild, index) => {
          const icon = guildIconUrl(guild);

          return (
            <li
              key={guild.id}
              style={delay(Math.min(index, 8) * 40)}
              className="m3-card m3-card-interactive rise flex flex-col gap-5 shadow-edge bg-surface-low p-5"
            >
              <div className="flex items-center gap-4">
                {icon === null ? (
                  <span className="shape-cookie9 grid size-14 shrink-0 place-items-center icon-tile text-lg font-semibold">
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
                  <Link
                    href={`/bots/${bot.id}/servers/${guild.id}`}
                    className={buttonClass("neutral")}
                  >
                    <Icon name="settings" className="-ml-1 size-[18px]" />
                    Configure
                  </Link>
                ) : (
                  <a
                    href={customBotInviteUrl(bot.applicationId)}
                    target="_blank"
                    rel="noreferrer"
                    className={buttonClass("outlined")}
                  >
                    <Icon name="groupAdd" className="-ml-1 size-[18px]" />
                    Add {bot.name}
                  </a>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
