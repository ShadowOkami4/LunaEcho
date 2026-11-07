import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { Icon } from "@/components/icon";
import { guildIconUrl } from "@/lib/discord";
import { workspaceFor } from "@/lib/workspace";

import { setModuleEnabled } from "./actions";
import { GroupTabs, ModuleFrame, ModulePane, type ModuleSwitchState } from "./tabs";

export default async function GuildLayout({
  children,
  params,
}: Readonly<{ children: ReactNode; params: Promise<{ botId?: string; guildId: string }> }>) {
  const { app, customBot, guild, guildId, scope, serverList } = await workspaceFor(params);
  const icon = guildIconUrl(guild);
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
          href={serverList}
          title={customBot === undefined ? "Switch server" : `Switch ${customBot.name}'s server`}
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
          {customBot !== undefined && (
            // Which bot these settings belong to; LunaEcho itself may be in the same server.
            <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary">
              {customBot.name}
            </span>
          )}
          <Icon name="expandMore" className="size-5 text-muted" />
        </Link>
        <GroupTabs scope={scope} />
      </div>

      {/* The module pane appears only for groups with several pages. */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:gap-6 lg:has-[>nav]:grid-cols-[17rem_minmax(0,1fr)]">
        <ModulePane scope={scope} states={states} toggleAction={setModuleEnabled} />
        <section className="flex min-w-0 flex-col gap-8 rounded-m3-xl-inc bg-surface-lowest p-5 shadow-edge sm:p-8">
          <ModuleFrame scope={scope} states={states}>
            {children}
          </ModuleFrame>
        </section>
      </div>
    </div>
  );
}
