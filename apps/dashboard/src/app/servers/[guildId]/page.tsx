import { planNames } from "@lunaecho/core";
import Link from "next/link";

import { requireManageableGuild } from "@/lib/access";
import { delay } from "@/lib/motion";
import { services } from "@/lib/services";

import { setModuleEnabled } from "./actions";
import { Chip, HiddenGuild, Notice, Switch } from "./ui";

export const dynamic = "force-dynamic";

/** Where each module's settings live; modules without a page have no link. */
const settingsPages: Readonly<Partial<Record<string, string>>> = {
  automation: "/automation",
  levels: "/levels",
  logs: "/logs",
  moderation: "/moderation",
  music: "/music",
  onboarding: "/welcome",
  roles: "/roles",
  "social-notifications": "/social",
  tickets: "/tickets",
  "voice-rooms": "/voice-rooms",
};

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

  return (
    <div className="flex flex-col gap-6">
      <Notice code={(await searchParams).notice} />

      <section className="rise grid gap-6 rounded-m3-xl-inc bg-surface-low p-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:p-8">
        <div>
          <p className="label text-primary">Modules</p>
          <h2 className="display mt-2 text-[clamp(2rem,4vw,3.2rem)]">
            Enable what matters.
            <br />
            <span className="text-muted">Leave the rest quiet.</span>
          </h2>
          <p className="mt-3 max-w-2xl text-sm text-muted">
            Switching a module off keeps its settings, so you can switch it back on anytime.
          </p>
        </div>
        <dl className="flex gap-3">
          <div className="rounded-m3-xl bg-primary-container px-6 py-4 text-on-primary-container">
            <dt className="label opacity-80">Running</dt>
            <dd className="display text-5xl">
              {running}
              <span className="text-2xl opacity-70">/{states.length}</span>
            </dd>
          </div>
          <div className="rounded-m3-xl bg-surface-high px-6 py-4">
            <dt className="label text-faint">Plan</dt>
            <dd className="display mt-1 text-3xl">{planNames[entitlement.planId]}</dd>
          </div>
        </dl>
      </section>

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {states.map(({ enabled, module }, index) => {
          const included = entitlement.capabilities.has(module.id);
          const settingsPage = settingsPages[module.id];

          return (
            <li
              key={module.id}
              style={delay(Math.min(index, 11) * 40)}
              className={`m3-card m3-card-interactive rise flex min-h-52 flex-col p-6 sm:min-h-60 ${
                enabled
                  ? "bg-[color-mix(in_srgb,var(--color-primary-container)_12%,var(--color-surface))]"
                  : "bg-surface"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <span className="label text-primary">{String(index + 1).padStart(2, "0")}</span>
                {module.status === "planned" ? (
                  <Chip>Coming later</Chip>
                ) : !included ? (
                  <Chip tone="tertiary">Not in plan</Chip>
                ) : (
                  <form action={setModuleEnabled}>
                    <HiddenGuild guildId={guildId} />
                    <input type="hidden" name="moduleId" value={module.id} />
                    <input type="hidden" name="enabled" value={String(!enabled)} />
                    <Switch
                      label={`${module.displayName} ${enabled ? "on" : "off"}`}
                      on={enabled}
                    />
                  </form>
                )}
              </div>
              <h3 className="display mt-6 text-[clamp(1.6rem,2.4vw,2.1rem)] leading-none sm:mt-8">
                {module.displayName}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{module.description}</p>
              <div className="mt-auto flex flex-wrap items-center gap-2 pt-5">
                {module.enabledByDefault && <Chip tone="primary">Essential</Chip>}
                <Chip>{enabled ? "On" : "Off"}</Chip>
                {settingsPage !== undefined && (
                  <Link
                    href={`/servers/${guildId}${settingsPage}`}
                    className="ml-auto text-sm font-semibold text-primary hover:underline"
                  >
                    Settings →
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
