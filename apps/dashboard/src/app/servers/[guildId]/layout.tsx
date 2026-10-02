import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { Icon } from "@/components/icon";
import { requireManageableGuild } from "@/lib/access";
import { guildIconUrl } from "@/lib/discord";
import { services } from "@/lib/services";

import { setModuleEnabled } from "./actions";
import { ModuleFrame, Navigation, type ModuleSwitchState } from "./tabs";

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
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[17rem_minmax(0,1fr)] lg:gap-10">
      <aside className="flex min-w-0 flex-col gap-5 lg:sticky lg:top-24 lg:self-start">
        <div className="flex items-center gap-3 rounded-m3-xl bg-surface-low p-3">
          {icon === null ? (
            <span className="shape-cookie9 grid size-12 shrink-0 place-items-center bg-secondary-container font-semibold text-on-secondary-container">
              {guild.name.slice(0, 2)}
            </span>
          ) : (
            <Image
              src={icon}
              alt=""
              width={48}
              height={48}
              className="shape-cookie9 size-12 shrink-0"
            />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{guild.name}</p>
            <Link
              href="/servers"
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              <Icon name="arrowBack" className="size-3.5" />
              Switch server
            </Link>
          </div>
        </div>
        <Navigation guildId={guildId} />
      </aside>

      <div className="flex min-w-0 flex-col gap-6">
        <ModuleFrame guildId={guildId} states={states} toggleAction={setModuleEnabled}>
          {children}
        </ModuleFrame>
      </div>
    </div>
  );
}
