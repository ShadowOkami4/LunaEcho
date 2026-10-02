import { cookies } from "next/headers";
import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";

import { Icon, type IconName } from "@/components/icon";
import { MultiSelectMenu, SelectMenu, type MenuOption } from "@/components/select-menu";

export { buttonClass, inputClass, textAreaClass, type ButtonTone } from "./styles";

/** Carries a validation message from a server action to the next page view. */
export const errorNoticeCookie = "lunaecho-notice";

const notices: Readonly<Record<string, Readonly<{ text: string; tone: "danger" | "success" }>>> = {
  "already-exists": { text: "That word is already on the list.", tone: "danger" },
  invalid: { text: "That value is not valid for this server.", tone: "danger" },
  "invalid-word": {
    text: "Banned words need 2 to 64 visible characters and no control characters.",
    tone: "danger",
  },
  "limit-reached": { text: "The limit for this list is reached.", tone: "danger" },
  "module-planned": { text: "That module is not available yet.", tone: "danger" },
  posted: {
    text: "Saved. LunaEcho posts the message within a few seconds.",
    tone: "success",
  },
  removed: { text: "Removed.", tone: "success" },
  "ticket-incomplete": {
    text: "Choose and save a ticket channel before posting the panel.",
    tone: "danger",
  },
  "verification-incomplete": {
    text: "Choose and save a panel channel and a role before posting the panel.",
    tone: "danger",
  },
  saved: {
    text: "Saved. LunaEcho picks up the change within a few seconds.",
    tone: "success",
  },
  "unknown-module": { text: "Unknown module.", tone: "danger" },
};

export async function Notice({ code }: Readonly<{ code: string | undefined }>) {
  const message = code === "error" ? (await cookies()).get(errorNoticeCookie)?.value : undefined;
  const notice =
    message === undefined
      ? code === undefined
        ? undefined
        : notices[code]
      : ({ text: message, tone: "danger" } as const);

  if (notice === undefined) {
    return null;
  }

  const success = notice.tone === "success";

  // An M3 banner: an icon, the message, and a container in the tone's colour.
  return (
    <p
      role="status"
      className={`rise flex items-center gap-3 rounded-m3-lg px-4 py-3 text-sm font-medium ${
        success
          ? "bg-[color-mix(in_srgb,var(--color-success)_12%,var(--color-surface))] text-success"
          : "bg-danger-container text-on-danger-container"
      }`}
    >
      <Icon name={success ? "checkCircle" : "error"} className="size-5" />
      {notice.text}
    </p>
  );
}

/**
 * A section of a settings page: an M3 surface container with an optional leading icon. A
 * collapsible section folds away to its header, so long pages stay easy to scan.
 */
export function Card({
  action,
  children,
  collapsible = false,
  defaultOpen = true,
  description,
  icon,
  title,
}: Readonly<{
  /** Shown at the end of the header, for example a primary button. */
  action?: ReactNode;
  children: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  description?: ReactNode;
  /** Kept for older call sites; the section title is enough context. */
  eyebrow?: string;
  icon?: IconName;
  title: string;
}>) {
  const header = (
    <>
      {icon !== undefined && (
        <span className="shape-cookie9 grid size-11 shrink-0 place-items-center bg-secondary-container text-on-secondary-container">
          <Icon name={icon} className="size-5" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <h2 className="title-large">{title}</h2>
        {description !== undefined && (
          <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p>
        )}
      </div>
      {action}
    </>
  );

  if (collapsible) {
    return (
      <details open={defaultOpen} className="m3-card rise border border-outline/50 bg-surface-low">
        <summary className="flex cursor-pointer items-start gap-4 rounded-m3-xl p-5 hover:bg-surface/60 sm:p-6">
          {header}
          <Icon name="expandMore" className="m3-chevron mt-2 size-6 text-muted" />
        </summary>
        <div className="flex flex-col gap-4 px-5 pb-5 sm:px-6 sm:pb-6">{children}</div>
      </details>
    );
  }

  return (
    <section className="m3-card rise flex flex-col gap-5 border border-outline/50 bg-surface-low p-5 sm:p-6">
      <header className="flex items-start gap-4">{header}</header>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

/** A labelled M3 switch for a boolean form field. */
export function SwitchField({
  defaultChecked,
  description,
  label,
  name,
}: Readonly<{ defaultChecked: boolean; description?: string; label: string; name: string }>) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 rounded-m3-lg bg-surface px-4 py-3">
      <span>
        <span className="block font-medium">{label}</span>
        {description !== undefined && (
          <span className="block text-sm text-muted">{description}</span>
        )}
      </span>
      <input
        type="checkbox"
        name={name}
        value="true"
        defaultChecked={defaultChecked}
        className="m3-switch"
      />
    </label>
  );
}

// Buttons and switches read their form's pending state, so they live in a client module.
export { SubmitButton as Button, FormSwitch as Switch } from "@/components/submit-button";

/** An M3 assist chip for short facts and statuses. */
export function Chip({
  children,
  icon,
  tone = "neutral",
}: Readonly<{
  children: ReactNode;
  icon?: IconName;
  tone?: "neutral" | "primary" | "success" | "tertiary";
}>) {
  const styles = {
    neutral: "border border-outline text-muted",
    primary: "bg-secondary-container text-on-secondary-container",
    success: "bg-[color-mix(in_srgb,var(--color-success)_14%,transparent)] text-success",
    tertiary: "bg-tertiary/12 text-tertiary",
  } as const;

  return (
    <span
      className={`inline-flex h-7 items-center gap-1.5 rounded-m3-sm px-2.5 text-xs font-medium ${styles[tone]}`}
    >
      {icon !== undefined && <Icon name={icon} className="size-4" />}
      {children}
    </span>
  );
}

/**
 * An M3 input chip with a remove button. Place it inside the form that removes the item; the
 * close button submits that form.
 */
export function InputChip({
  children,
  removeLabel,
}: Readonly<{ children: ReactNode; removeLabel: string }>) {
  return (
    <span className="inline-flex h-8 items-center gap-1 rounded-m3-sm border border-outline bg-surface pr-1 pl-3 text-sm">
      {children}
      <button
        type="submit"
        aria-label={removeLabel}
        title={removeLabel}
        className="grid size-6 place-items-center rounded-full text-muted hover:bg-danger-container hover:text-on-danger-container"
      >
        <Icon name="close" className="size-4" />
      </button>
    </span>
  );
}

/** A row in a settings list: leading icon, text, and trailing controls. */
export function ListItem({
  children,
  icon,
  supporting,
  title,
}: Readonly<{ children?: ReactNode; icon?: IconName; supporting?: ReactNode; title: ReactNode }>) {
  return (
    <li className="flex flex-wrap items-center gap-4 py-3">
      {icon !== undefined && (
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-surface-highest text-muted">
          <Icon name={icon} className="size-5" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{title}</p>
        {supporting !== undefined && <p className="text-sm text-muted">{supporting}</p>}
      </div>
      {children}
    </li>
  );
}

/** M3 filled text field look, shared by inputs and selects. */
export function HiddenGuild({ guildId }: Readonly<{ guildId: string }>) {
  return <input type="hidden" name="guildId" value={guildId} />;
}

type Option = Readonly<{ color?: number; id: string; name: string; type?: number }>;

/**
 * A labelled form control. A native input sits inside a <label>. A menu cannot: a label belongs
 * to exactly one control and passes its hover and clicks to the first button inside, which in a
 * chip list is a remove button. Menus get a plain group and their label as an accessible name.
 */
export function Field({
  children,
  hint,
  label,
  wide = false,
}: Readonly<{ children: ReactNode; hint?: string; label: string; wide?: boolean }>) {
  const menu =
    isValidElement(children) && (children.type === Picker || children.type === MultiPicker);
  const className = `flex flex-col gap-1.5 text-sm ${wide ? "sm:col-span-2" : ""}`;
  const content = (
    <>
      <span className="font-medium text-muted">{label}</span>
      {menu ? cloneElement(children as ReactElement<{ label?: string }>, { label }) : children}
      {hint !== undefined && <span className="text-xs text-faint">{hint}</span>}
    </>
  );

  return menu ? (
    <div role="group" aria-label={label} className={className}>
      {content}
    </div>
  ) : (
    <label className={className}>{content}</label>
  );
}

/** Keeps only what the menus need, so whole Discord objects are not sent to the browser. */
function menuOptions(options: readonly Option[]): MenuOption[] {
  return options.map((option) => ({
    id: option.id,
    name: option.name,
    ...(option.color === undefined ? {} : { color: option.color }),
    ...(option.type === undefined ? {} : { type: option.type }),
  }));
}

/** A single choice with an empty "none" entry, or a required one without it. */
export function Picker({
  defaultValue,
  label,
  name,
  none,
  options,
  prefix = "",
}: Readonly<{
  defaultValue: string | null;
  /** Set by Field; the menu's accessible name. */
  label?: string;
  name: string;
  none?: string;
  options: readonly Option[];
  prefix?: string;
}>) {
  return (
    <SelectMenu
      {...(label === undefined ? {} : { label })}
      defaultValue={defaultValue}
      name={name}
      options={menuOptions(options)}
      prefix={prefix}
      {...(none === undefined ? {} : { none })}
    />
  );
}

/** Several choices as removable chips, with a searchable menu to add more. */
export function MultiPicker({
  addLabel,
  defaultValue,
  label,
  maximum,
  name,
  options,
  prefix = "",
}: Readonly<{
  addLabel?: string;
  defaultValue: readonly string[];
  /** Set by Field; the menu's accessible name. */
  label?: string;
  maximum?: number;
  name: string;
  options: readonly Option[];
  prefix?: string;
}>) {
  return (
    <MultiSelectMenu
      {...(label === undefined ? {} : { label })}
      addLabel={addLabel ?? (prefix === "@" ? "Add role" : prefix === "#" ? "Add channel" : "Add")}
      defaultValue={defaultValue}
      name={name}
      options={menuOptions(options)}
      prefix={prefix}
      {...(maximum === undefined ? {} : { maximum })}
    />
  );
}
