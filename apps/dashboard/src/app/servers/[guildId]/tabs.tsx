"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { Icon } from "@/components/icon";
import { FormSwitch } from "@/components/submit-button";

import { sectionGroups, sections, type Section, type SectionGroup } from "./sections";

function useCurrentSection(guildId: string): Section | undefined {
  const pathname = usePathname();
  const base = `/servers/${guildId}`;
  return sections.find((section) => pathname === `${base}${section.href}`);
}

function groupOf(section: Section | undefined): SectionGroup | undefined {
  return sectionGroups.find((group) => section !== undefined && group.sections.includes(section));
}

export type ModuleSwitchState = Readonly<{
  /** False when the module is planned or not part of the server's plan. */
  available: boolean;
  enabled: boolean;
  moduleId: string;
}>;

/**
 * The setting groups as tabs across the top. Each tab opens the first page of its group; the
 * pages inside a group are listed in the module pane beside the content.
 */
export function GroupTabs({ guildId }: Readonly<{ guildId: string }>) {
  const current = groupOf(useCurrentSection(guildId));

  return (
    <nav
      aria-label="Setting groups"
      className="-mx-4 flex min-w-0 gap-1 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0"
    >
      {sectionGroups.map((group) => {
        const selected = group === current;

        return (
          <Link
            key={group.label}
            href={`/servers/${guildId}${group.sections[0]?.href ?? ""}`}
            aria-current={selected ? "page" : undefined}
            className={`m3-button inline-flex h-10 shrink-0 items-center px-4 text-sm font-medium ${
              selected
                ? "bg-primary/15 font-semibold text-primary"
                : "text-muted hover:text-on-surface"
            }`}
          >
            {group.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * The console pane: every page of the current group with its module switch, as on the
 * LunaEcho project page. Groups with a single page (the overview) have no pane.
 */
export function ModulePane({
  guildId,
  states,
  toggleAction,
}: Readonly<{
  guildId: string;
  states: readonly ModuleSwitchState[];
  toggleAction: (formData: FormData) => Promise<void>;
}>) {
  const current = useCurrentSection(guildId);
  const group = groupOf(current);

  if (group === undefined || group.sections.length < 2) {
    return null;
  }

  return (
    <nav
      aria-label={`${group.label} pages`}
      className="flex flex-col gap-0.5 rounded-m3-xl-inc bg-surface-lowest p-1.5 shadow-edge lg:sticky lg:top-24 lg:gap-1 lg:self-start lg:p-2"
    >
      {group.sections.map((section) => {
        const selected = section === current;
        const state = states.find((candidate) => candidate.moduleId === section.moduleId);
        const on = state?.enabled ?? true;

        return (
          <div
            key={section.href}
            className={`flex items-center gap-2 rounded-m3-lg pr-2 transition-colors ${
              selected ? "bg-surface-high" : "hover:bg-surface"
            }`}
          >
            <Link
              href={`/servers/${guildId}${section.href}`}
              aria-current={selected ? "page" : undefined}
              className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-m3-lg px-3 lg:min-h-13"
            >
              <Icon
                name={section.icon}
                className={`size-5 ${on ? "text-primary" : "text-faint"}`}
              />
              <span className={`truncate text-sm font-semibold ${on ? "" : "text-muted"}`}>
                {section.label}
              </span>
            </Link>
            {state?.available === true ? (
              <form action={toggleAction}>
                <input type="hidden" name="guildId" value={guildId} />
                <input type="hidden" name="moduleId" value={state.moduleId} />
                <input type="hidden" name="enabled" value={String(!state.enabled)} />
                <input type="hidden" name="returnTo" value={current?.href ?? ""} />
                <FormSwitch label={`${section.label} module`} on={state.enabled} />
              </form>
            ) : (
              state !== undefined && (
                <span className="text-xs whitespace-nowrap text-tertiary">Not in plan</span>
              )
            )}
          </div>
        );
      })}
    </nav>
  );
}

/**
 * The header of a settings page and its content. While the page's module is off, its settings
 * stay visible but greyed out and locked, so nothing is changed by accident.
 */
export function ModuleFrame({
  children,
  guildId,
  states,
}: Readonly<{
  children: ReactNode;
  guildId: string;
  states: readonly ModuleSwitchState[];
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
        <header key={current.href} className="page-enter flex items-start gap-4">
          <span
            className={`shape-cookie9 grid size-14 shrink-0 place-items-center transition-colors ${
              off ? "icon-tile-off" : "icon-tile-on"
            }`}
          >
            <Icon name={current.icon} className="size-7" />
          </span>
          <div className="min-w-0 flex-1 pt-1">
            <h1 className="headline-large">{current.label}</h1>
            <p className="mt-1.5 text-sm text-muted">{current.description}</p>
          </div>
        </header>
      )}

      {off && (
        <p className="flex items-center gap-3 rounded-m3-lg bg-surface px-4 py-3 text-sm text-muted">
          <Icon name="powerSettingsNew" className="size-5 shrink-0" />
          This module is off, so LunaEcho ignores these settings. They are kept; switch the module
          on to change them.
        </p>
      )}

      {/* A disabled fieldset locks every control inside, including buttons and the menus. */}
      <fieldset
        disabled={off}
        aria-disabled={off}
        className={`m-0 flex min-w-0 flex-col gap-8 border-0 p-0 transition-[opacity,filter] ${
          off ? "opacity-50 saturate-50" : ""
        }`}
      >
        <div key={current?.href ?? "page"} className="page-enter flex min-w-0 flex-col gap-8">
          {children}
        </div>
      </fieldset>
    </>
  );
}
