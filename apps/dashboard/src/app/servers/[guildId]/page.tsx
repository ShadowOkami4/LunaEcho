import { planNames } from "@lunaecho/core";
import Link from "next/link";

import { Icon } from "@/components/icon";
import { requireManageableGuild } from "@/lib/access";
import { delay } from "@/lib/motion";
import { services } from "@/lib/services";

import { setModuleEnabled } from "./actions";
import { moduleIcons, sectionGroups, sections } from "./sections";
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

  // The same groups as the tabs; modules without a settings page are listed last.
  const groupOf = new Map(
    sectionGroups.flatMap((group) =>
      group.sections.flatMap((section) =>
        section.moduleId === undefined ? [] : [[section.moduleId, group.label] as const],
      ),
    ),
  );
  const groups = [...sectionGroups.map((group) => group.label), "More"]
    .map((label) => ({
      label,
      modules: states.filter((state) => (groupOf.get(state.module.id) ?? "More") === label),
    }))
    .filter((group) => group.modules.length > 0);

  return (
    <div className="flex flex-col gap-8">
      <Notice code={(await searchParams).notice} />

      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm text-muted">
        <span>
          <span className="display text-3xl text-primary">{running}</span> of {states.length}{" "}
          modules running
        </span>
        <span aria-hidden>·</span>
        <span>
          <span className="text-tertiary">{planNames[entitlement.planId]}</span> plan
        </span>
        <span aria-hidden>·</span>
        <span>A module that is off keeps its settings.</span>
      </p>

      <div className="grid gap-x-10 gap-y-8 xl:grid-cols-2">
        {groups.map((group, groupIndex) => (
          <section key={group.label} className="flex flex-col gap-2">
            <h2 className="label text-tertiary uppercase">{group.label}</h2>
            <ul className="flex flex-col">
              {group.modules.map(({ enabled, module }, index) => {
                const included = entitlement.capabilities.has(module.id);
                const href = settingsPage.get(module.id);

                return (
                  <li
                    key={module.id}
                    style={delay(Math.min(groupIndex * 3 + index, 11) * 30)}
                    className="rise flex items-center gap-4 border-b border-white/6 py-3.5 last:border-0"
                  >
                    <span
                      className={`shape-cookie9 grid size-10 shrink-0 place-items-center transition-colors ${
                        enabled && included ? "icon-tile-on" : "icon-tile-off"
                      }`}
                    >
                      <Icon name={moduleIcons[module.id] ?? "apps"} className="size-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-x-2 font-semibold">
                        {href === undefined ? (
                          module.displayName
                        ) : (
                          <Link
                            href={`/servers/${guildId}${href}`}
                            className="inline-flex items-center gap-0.5 hover:text-primary"
                          >
                            {module.displayName}
                            <Icon name="chevronRight" className="size-4 text-faint" />
                          </Link>
                        )}
                        {module.enabledByDefault && (
                          <span className="text-xs font-medium text-faint">Essential</span>
                        )}
                      </p>
                      <p className="truncate text-sm text-muted">{module.description}</p>
                    </div>
                    {module.status === "planned" ? (
                      <Chip icon="schedule">Coming later</Chip>
                    ) : !included ? (
                      <Chip tone="tertiary">Not in this plan</Chip>
                    ) : (
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
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
