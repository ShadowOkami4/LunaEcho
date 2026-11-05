import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { Icon } from "@/components/icon";
import { requireManageableGuild } from "@/lib/access";
import { guildIconUrl } from "@/lib/discord";
import { services } from "@/lib/services";

import { setModuleEnabled } from "./actions";
import { GroupTabs, ModuleFrame, ModulePane, type ModuleSwitchState } from "./tabs";

export default async function GuildLayout({
  children,
  params,
}: Readonly<{ children: ReactNode; params: Promise<{ guildId: string }> }>) {
  const { guildId } = await params;
  const { guild } = await requireManageableGuild(guildId);
  const icon = guildIconUrl(guild);
  const app = await services();
  const [moduleStates, entitlement] = await Promise.all([
    app.moduleSettings.getStates(guildId),
    app.entitlements.resolveForGuild(guildId),
  ]);
  const states: ModuleSwitchState[] = moduleStates.map(({ enabled, module }) => ({
    available: module.status === "available" && entitlement.capabilities.has(module.id),
    enabled,
    moduleId: module.id,
  }));

  return (
    <div className="flex flex-col gap-6">
      {/* The server switcher and the setting groups. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
        <Link
          href="/servers"
          title="Switch server"
          className="m3-button flex max-w-full shrink-0 items-center gap-2.5 self-start bg-surface-low py-1.5 pr-3 pl-1.5 shadow-edge hover:bg-surface sm:max-w-64 sm:self-auto"
        >
          {icon === null ? (
            <span className="icon-tile grid size-8 shrink-0 place-items-center rounded-full text-xs font-semibold">
              {guild.name.slice(0, 2)}
            </span>
          ) : (
            <Image src={icon} alt="" width={32} height={32} className="size-8 rounded-full" />
          )}
          <span className="min-w-0 truncate text-sm font-semibold">{guild.name}</span>
          <Icon name="expandMore" className="size-5 text-muted" />
        </Link>
        <GroupTabs guildId={guildId} />
      </div>

      {/* The module pane appears only for groups with several pages. */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:gap-6 lg:has-[>nav]:grid-cols-[17rem_minmax(0,1fr)]">
        <ModulePane guildId={guildId} states={states} toggleAction={setModuleEnabled} />
        <section className="flex min-w-0 flex-col gap-8 rounded-m3-xl-inc bg-surface-lowest p-5 shadow-edge sm:p-8">
          <ModuleFrame guildId={guildId} states={states}>
            {children}
          </ModuleFrame>
        </section>
      </div>
    </div>
  );
}
