import { cookies } from "next/headers";
import type { ReactNode } from "react";

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

  // An M3 snackbar-style message with a shape marker in the tone's colour.
  return (
    <p
      role="status"
      className={`rise flex items-center gap-3 rounded-m3-lg px-5 py-3.5 text-sm font-medium ${
        notice.tone === "success"
          ? "bg-[color-mix(in_srgb,var(--color-success)_14%,var(--color-surface))] text-success"
          : "bg-danger-container text-on-danger-container"
      }`}
    >
      <span
        aria-hidden
        className={`shape-cookie4 size-3 shrink-0 ${
          notice.tone === "success" ? "bg-success" : "bg-danger"
        }`}
      />
      {notice.text}
    </p>
  );
}

/** A section of a settings page: an M3 Expressive surface container. */
export function Card({
  children,
  description,
  eyebrow,
  title,
}: Readonly<{ children: ReactNode; description?: string; eyebrow?: string; title: string }>) {
  return (
    <section className="m3-card rise relative flex flex-col gap-5 overflow-hidden bg-surface p-6 sm:p-7">
      <div
        aria-hidden
        className="shape-cookie9 pointer-events-none absolute -top-24 -right-20 size-56 bg-primary/8"
      />
      <div className="relative">
        {eyebrow !== undefined && <p className="label mb-2 text-primary">{eyebrow}</p>}
        <h2 className="display text-[clamp(1.6rem,2.6vw,2.2rem)]">{title}</h2>
        {description !== undefined && (
          <p className="mt-2 max-w-3xl text-sm text-muted">{description}</p>
        )}
      </div>
      <div className="relative flex flex-col gap-4">{children}</div>
    </section>
  );
}

const buttonStyles = {
  danger: "bg-danger-container text-on-danger-container hover:bg-danger-container/80",
  neutral: "bg-secondary-container text-on-secondary-container hover:bg-secondary-container/80",
  primary: "bg-primary text-on-primary hover:bg-primary-strong",
} as const;

/** M3 Expressive buttons: filled, tonal, or error; they square off while pressed. */
export function Button({
  children,
  tone = "primary",
}: Readonly<{ children: ReactNode; tone?: keyof typeof buttonStyles }>) {
  return (
    <button
      type="submit"
      className={`m3-button inline-flex h-10 items-center justify-center gap-2 px-5 text-sm font-semibold ${buttonStyles[tone]}`}
    >
      {children}
    </button>
  );
}

/** An M3 switch that submits its form; the form says which state it switches to. */
export function Switch({ label, on }: Readonly<{ label: string; on: boolean }>) {
  return (
    <button
      type="submit"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className="flex shrink-0 items-center rounded-full"
    >
      <span className="m3-switch" data-on={on} />
    </button>
  );
}

/** M3 assist chip, for small facts such as "essential". */
export function Chip({
  children,
  tone = "neutral",
}: Readonly<{ children: ReactNode; tone?: "neutral" | "primary" | "tertiary" }>) {
  const styles = {
    neutral: "bg-surface-highest text-muted",
    primary: "bg-secondary-container text-on-secondary-container",
    tertiary: "bg-tertiary/15 text-tertiary",
  } as const;

  return (
    <span className={`label inline-flex items-center rounded-full px-2.5 py-1 ${styles[tone]}`}>
      {children}
    </span>
  );
}

/** M3 filled text field look, shared by inputs and selects. */
export const inputClass =
  "rounded-m3-md border-b-2 border-outline-strong/60 bg-surface-highest px-3.5 py-2.5 text-sm text-on-surface transition-colors placeholder:text-faint hover:bg-surface-bright focus:border-primary focus:outline-none";

export function HiddenGuild({ guildId }: Readonly<{ guildId: string }>) {
  return <input type="hidden" name="guildId" value={guildId} />;
}

export const textAreaClass = `${inputClass} min-h-28 leading-relaxed`;

type Option = Readonly<{ id: string; name: string }>;

export function Field({
  children,
  hint,
  label,
  wide = false,
}: Readonly<{ children: ReactNode; hint?: string; label: string; wide?: boolean }>) {
  return (
    <label className={`flex flex-col gap-1.5 text-sm ${wide ? "sm:col-span-2" : ""}`}>
      <span className="font-medium text-muted">{label}</span>
      {children}
      {hint !== undefined && <span className="text-xs text-faint">{hint}</span>}
    </label>
  );
}

/** A single choice with an empty "none" entry, or a required one without it. */
export function Picker({
  defaultValue,
  name,
  none,
  options,
  prefix = "",
}: Readonly<{
  defaultValue: string | null;
  name: string;
  none?: string;
  options: readonly Option[];
  prefix?: string;
}>) {
  return (
    <select
      name={name}
      defaultValue={defaultValue ?? ""}
      required={none === undefined}
      className={inputClass}
    >
      {none !== undefined && <option value="">{none}</option>}
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {prefix}
          {option.name}
        </option>
      ))}
    </select>
  );
}

/** Several choices; hold Ctrl or Cmd to pick more than one. */
export function MultiPicker({
  defaultValue,
  name,
  options,
  prefix = "",
}: Readonly<{
  defaultValue: readonly string[];
  name: string;
  options: readonly Option[];
  prefix?: string;
}>) {
  return (
    <select
      name={name}
      multiple
      defaultValue={[...defaultValue]}
      size={Math.min(8, Math.max(3, options.length))}
      className={inputClass}
    >
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {prefix}
          {option.name}
        </option>
      ))}
    </select>
  );
}
