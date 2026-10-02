"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { Icon } from "@/components/icon";
import { FormSwitch } from "@/components/submit-button";

import { sectionGroups, sections, type Section } from "./sections";

function useCurrentSection(guildId: string): Section | undefined {
  const pathname = usePathname();
  const base = `/servers/${guildId}`;
  return sections.find((section) => pathname === `${base}${section.href}`);
}

/**
 * M3 navigation drawer on wide screens: grouped destinations with icons, the current one marked
 * by the secondary-container indicator. On narrow screens the same destinations scroll as chips.
 */
export function Navigation({ guildId }: Readonly<{ guildId: string }>) {
  const current = useCurrentSection(guildId);
  const base = `/servers/${guildId}`;

  return (
    <>
      <nav aria-label="Server settings" className="hidden flex-col gap-4 lg:flex">
        {sectionGroups.map((group) => (
          <div key={group.label} className="flex flex-col gap-0.5">
            <p className="label px-4 pb-1 text-faint">{group.label}</p>
            {group.sections.map((section) => {
              const selected = section === current;

              return (
                <Link
                  key={section.href}
                  href={`${base}${section.href}`}
                  aria-current={selected ? "page" : undefined}
                  className={`m3-button nav-item flex h-12 items-center gap-3 px-4 text-sm font-medium ${
                    selected
                      ? "font-semibold text-on-secondary-container"
                      : "text-muted hover:text-on-surface"
                  }`}
                >
                  <Icon name={section.icon} className="size-5" />
                  {section.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <nav
        aria-label="Server settings"
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] lg:hidden"
      >
        {sections.map((section) => {
          const selected = section === current;

          return (
            <Link
              key={section.href}
              href={`${base}${section.href}`}
              aria-current={selected ? "page" : undefined}
              className={`m3-button inline-flex h-9 shrink-0 items-center gap-2 px-3.5 text-sm font-medium ${
                selected
                  ? "bg-secondary-container text-on-secondary-container"
                  : "border border-outline text-muted"
              }`}
            >
              <Icon name={section.icon} className="size-[18px]" />
              {section.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}

export type ModuleSwitchState = Readonly<{
  /** False when the module is planned or not part of the server's plan. */
  available: boolean;
  enabled: boolean;
  moduleId: string;
}>;

/**
 * The header of a settings page with the module's own on/off switch. While the module is off,
 * its settings stay visible but greyed out and locked, so nothing is changed by accident.
 */
export function ModuleFrame({
  children,
  guildId,
  states,
  toggleAction,
}: Readonly<{
  children: ReactNode;
  guildId: string;
  states: readonly ModuleSwitchState[];
  toggleAction: (formData: FormData) => Promise<void>;
}>) {
  const current = useCurrentSection(guildId);
  const state =
    current?.moduleId === undefined
      ? undefined
      : states.find((candidate) => candidate.moduleId === current.moduleId);
  const off = state !== undefined && !state.enabled;

  return (
    <>
      {current !== undefined && (
        <header
          key={current.href}
          className="morph-trigger page-enter relative flex flex-wrap items-center gap-5 overflow-hidden rounded-m3-xxl bg-[linear-gradient(135deg,color-mix(in_srgb,var(--color-primary-container)_16%,var(--color-surface-low)),var(--color-surface-low)_60%,color-mix(in_srgb,var(--color-tertiary)_10%,var(--color-surface-low)))] p-5 sm:p-6"
        >
          <div
            aria-hidden
            className={`shape-morph pointer-events-none absolute -top-24 -right-16 size-48 transition-colors ${
              off ? "bg-on-surface/3" : "bg-primary/7"
            }`}
          />
          <span
            className={`shape-cookie9 relative grid size-16 shrink-0 place-items-center transition-colors ${
              off
                ? "bg-surface-highest text-muted"
                : "bg-primary-container text-on-primary-container"
            }`}
          >
            <Icon name={current.icon} className="size-8" />
          </span>
          <div className="relative min-w-0 flex-1">
            <h1 className="headline-large">{current.label}</h1>
            <p className="text-sm text-muted">{current.description}</p>
          </div>
          {state?.available === true && (
            <form
              action={toggleAction}
              className="relative flex items-center gap-3 rounded-full bg-background/60 py-1.5 pr-1.5 pl-4 backdrop-blur"
            >
              <input type="hidden" name="guildId" value={guildId} />
              <input type="hidden" name="moduleId" value={state.moduleId} />
              <input type="hidden" name="enabled" value={String(!state.enabled)} />
              <input type="hidden" name="returnTo" value={current.href} />
              <span className={`text-sm font-medium ${off ? "text-muted" : "text-success"}`}>
                {off ? "Module off" : "Module on"}
              </span>
              <FormSwitch label={`${current.label} module`} on={!off} />
            </form>
          )}
        </header>
      )}

      {off && (
        <p className="flex items-center gap-3 rounded-m3-lg border border-outline/60 bg-surface-low px-4 py-3 text-sm text-muted">
          <Icon name="powerSettingsNew" className="size-5 shrink-0" />
          This module is off, so LunaEcho ignores these settings. They are kept; switch the module
          on to change them.
        </p>
      )}

      {/* A disabled fieldset locks every control inside, including buttons and the menus. */}
      <fieldset
        disabled={off}
        aria-disabled={off}
        className={`m-0 flex min-w-0 flex-col gap-6 border-0 p-0 transition-[opacity,filter] ${
          off ? "opacity-50 saturate-50" : ""
        }`}
      >
        <div key={current?.href ?? "page"} className="page-enter flex min-w-0 flex-col gap-6">
          {children}
        </div>
      </fieldset>
    </>
  );
}
