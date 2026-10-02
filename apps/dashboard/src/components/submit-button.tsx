"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

import { buttonClass, type ButtonTone } from "@/app/servers/[guildId]/styles";

import { Icon, type IconName } from "./icon";
import { Loader } from "./loader";

/**
 * M3 Expressive buttons: filled, tonal, outlined, text, or error; they square off when pressed.
 * While their form is being saved they show the loading indicator and cannot be pressed again.
 */
export function SubmitButton({
  children,
  icon,
  tone = "primary",
}: Readonly<{ children: ReactNode; icon?: IconName; tone?: ButtonTone }>) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" disabled={pending} aria-busy={pending} className={buttonClass(tone)}>
      {pending ? (
        <Loader className="-ml-1 size-[18px]" label="Saving" />
      ) : (
        icon !== undefined && <Icon name={icon} className="-ml-1 size-[18px]" />
      )}
      {children}
    </button>
  );
}

/**
 * An M3 switch that submits its form; the form says which state it switches to. It flips at
 * once while the change is saved, so it feels immediate.
 */
export function FormSwitch({ label, on }: Readonly<{ label: string; on: boolean }>) {
  const { pending } = useFormStatus();
  const shown = pending ? !on : on;

  return (
    <button
      type="submit"
      role="switch"
      aria-checked={shown}
      aria-busy={pending}
      aria-label={label}
      disabled={pending}
      className="flex shrink-0 items-center rounded-full"
    >
      <span className="m3-switch" data-on={shown} />
    </button>
  );
}
