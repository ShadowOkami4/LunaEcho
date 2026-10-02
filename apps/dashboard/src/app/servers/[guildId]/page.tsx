import { planNames } from "@lunaecho/core";
import Link from "next/link";

import { Icon } from "@/components/icon";
import { requireManageableGuild } from "@/lib/access";
import { delay } from "@/lib/motion";
import { services } from "@/lib/services";

import { setModuleEnabled } from "./actions";
import { moduleIcons, sections } from "./sections";
import { Chip, HiddenGuild, Notice, Switch } from "./ui";

export const dynamic = "force-dynamic";

export default async function ModulesPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ guildId: string }>;
  searchParams: Promise<{ notice?: string }>;
}>) {
  const { guildId } = await params;
  await requireManageableGuild(guildId);
  const app = await services();
  const [states, entitlement] = await Promise.all([
    app.moduleSettings.getStates(guildId),
    app.entitlements.resolveForGuild(guildId),
  ]);
  const running = states.filter((state) => state.enabled).length;
  const settingsPage = new Map(
    sections.flatMap((section) =>
      section.moduleId === undefined ? [] : [[section.moduleId, section.href] as const],
    ),
  );

  return (
    <div className="flex flex-col gap-6">
      <Notice code={(await searchParams).notice} />

      <dl className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-m3-xl bg-primary-container p-5 text-on-primary-container">
          <dt className="text-sm font-medium opacity-80">Modules running</dt>
          <dd className="headline-large mt-1">
            {running}
            <span className="text-xl font-medium opacity-70"> of {states.length}</span>
          </dd>
        </div>
        <div className="rounded-m3-xl border border-outline/50 bg-surface-low p-5">
          <dt className="text-sm font-medium text-muted">Plan</dt>
          <dd className="headline-large mt-1">{planNames[entitlement.planId]}</dd>
        </div>
        <div className="rounded-m3-xl border border-outline/50 bg-surface-low p-5">
          <dt className="text-sm font-medium text-muted">Switching off</dt>
          <dd className="mt-2 text-sm text-muted">
            A module that is off keeps all its settings, so it continues where it left off.
          </dd>
        </div>
      </dl>

      <ul className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
        {states.map(({ enabled, module }, index) => {
          const included = entitlement.capabilities.has(module.id);
          const href = settingsPage.get(module.id);

          return (
            <li
              key={module.id}
              style={delay(Math.min(index, 11) * 30)}
              className="m3-card m3-card-interactive rise flex flex-col gap-4 border border-outline/50 bg-surface-low p-5"
            >
              <div className="flex items-start gap-4">
                <span
                  className={`shape-cookie9 grid size-12 shrink-0 place-items-center transition-colors ${
                    enabled
                      ? "bg-primary-container text-on-primary-container"
                      : "bg-surface-highest text-muted"
                  }`}
                >
                  <Icon name={moduleIcons[module.id] ?? "apps"} className="size-6" />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="title-medium">{module.displayName}</h2>
                  <p className="mt-0.5 text-sm text-muted">{module.description}</p>
                </div>
                {module.status === "available" && included && (
                  <form action={setModuleEnabled}>
                    <HiddenGuild guildId={guildId} />
                    <input type="hidden" name="moduleId" value={module.id} />
                    <input type="hidden" name="enabled" value={String(!enabled)} />
                    <Switch
                      label={`${module.displayName}: ${enabled ? "on" : "off"}`}
                      on={enabled}
                    />
                  </form>
                )}
              </div>
              <div className="mt-auto flex flex-wrap items-center gap-2">
                {module.status === "planned" ? (
                  <Chip icon="schedule">Coming later</Chip>
                ) : !included ? (
                  <Chip tone="tertiary">Not in this plan</Chip>
                ) : enabled ? (
                  <Chip tone="success" icon="checkCircle">
                    Running
                  </Chip>
                ) : (
                  <Chip>Off</Chip>
                )}
                {module.enabledByDefault && <Chip tone="primary">Essential</Chip>}
                {href !== undefined && (
                  <Link
                    href={`/servers/${guildId}${href}`}
                    className="m3-button ml-auto inline-flex h-9 items-center gap-1 pr-2 pl-3 text-sm font-semibold text-primary hover:bg-primary/8"
                  >
                    Configure
                    <Icon name="chevronRight" className="size-5" />
                  </Link>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
