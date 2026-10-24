"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { Icon } from "@/components/icon";
import { Loader } from "@/components/loader";

import { buttonClass, inputClass } from "../styles";

export type CardDesignerValues = Readonly<{
  accentColor: string;
  background: string;
  goodbyeEnabled: boolean;
  goodbyeSubtitle: string;
  goodbyeTitle: string;
  layout: string;
  overlayOpacity: number;
  textColor: string;
  welcomeEnabled: boolean;
  welcomeSubtitle: string;
  welcomeTitle: string;
}>;

/** CSS approximations of the renderer's presets, for the swatches. */
const backgrounds = [
  {
    id: "luna",
    label: "Luna",
    swatch:
      "radial-gradient(circle at 15% 20%, rgba(158,207,255,.6), transparent 55%), radial-gradient(circle at 85% 85%, rgba(255,133,210,.7), transparent 55%), #191115",
  },
  {
    id: "night",
    label: "Night",
    swatch:
      "radial-gradient(circle at 50% -10%, rgba(171,116,255,.55), transparent 60%), radial-gradient(circle at 50% 120%, rgba(255,133,210,.3), transparent 55%), #100c14",
  },
  {
    id: "aurora",
    label: "Aurora",
    swatch:
      "radial-gradient(circle at 15% 20%, rgba(120,220,200,.6), transparent 55%), radial-gradient(circle at 85% 85%, rgba(158,207,255,.55), transparent 55%), #0f1a24",
  },
  {
    id: "sunset",
    label: "Sunset",
    swatch:
      "radial-gradient(circle at 10% 90%, rgba(255,170,110,.7), transparent 55%), radial-gradient(circle at 90% 10%, rgba(255,133,210,.6), transparent 55%), #2a1219",
  },
] as const;

function Group({ children, label }: Readonly<{ children: ReactNode; label: string }>) {
  return (
    <fieldset className="flex flex-col gap-2.5">
      <legend className="mb-2.5 text-sm font-medium text-muted">{label}</legend>
      {children}
    </fieldset>
  );
}

function ColorField({
  label,
  name,
  onChange,
  value,
}: Readonly<{ label: string; name: string; onChange: (value: string) => void; value: string }>) {
  return (
    <label className="flex items-center gap-3 rounded-m3-lg bg-surface px-3 py-2">
      <input
        type="color"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className="size-9 cursor-pointer rounded-full border-0 bg-transparent p-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0"
        aria-label={label}
      />
      <span className="flex-1 text-sm">{label}</span>
      <input type="hidden" name={name} value={value} />
      <code className="text-xs text-muted">{value}</code>
    </label>
  );
}

/**
 * Edits the welcome card with a live preview. The preview is drawn on the server by the same
 * renderer the bot uses, with the signed-in user as the sample member.
 */
export function CardDesigner({
  action,
  guildId,
  hasBackgroundImage,
  initial,
}: Readonly<{
  action: (formData: FormData) => Promise<void>;
  guildId: string;
  hasBackgroundImage: boolean;
  initial: CardDesignerValues;
}>) {
  const [values, setValues] = useState(initial);
  const [kind, setKind] = useState<"goodbye" | "welcome">("welcome");
  const set = <Key extends keyof CardDesignerValues>(key: Key, value: CardDesignerValues[Key]) => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  const previewQuery = useMemo(
    () =>
      new URLSearchParams({
        accentColor: values.accentColor,
        background: values.background,
        layout: values.layout,
        overlayOpacity: String(values.overlayOpacity),
        subtitle: kind === "welcome" ? values.welcomeSubtitle : values.goodbyeSubtitle,
        textColor: values.textColor,
        title: kind === "welcome" ? values.welcomeTitle : values.goodbyeTitle,
      }).toString(),
    [values, kind],
  );
  // Typing should not ask the server for a new picture on every key press.
  const [previewSource, setPreviewSource] = useState(
    `/servers/${guildId}/welcome/card-preview?${previewQuery}`,
  );

  // The picture that finished loading; while it differs from the source, a new one is coming.
  const [loadedSource, setLoadedSource] = useState<string | undefined>(undefined);
  const [failedSource, setFailedSource] = useState<string | undefined>(undefined);
  const loading = loadedSource !== previewSource && failedSource !== previewSource;
  const failed = failedSource === previewSource;
  const image = useRef<HTMLImageElement>(null);

  // The first picture can finish before React attaches its handlers, so its events are missed;
  // the element itself still knows whether it loaded.
  useEffect(() => {
    const element = image.current;

    if (element?.complete === true) {
      if (element.naturalWidth > 0) {
        setLoadedSource(element.getAttribute("src") ?? undefined);
      } else {
        setFailedSource(element.getAttribute("src") ?? undefined);
      }
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setPreviewSource(`/servers/${guildId}/welcome/card-preview?${previewQuery}`);
    }, 350);
    return () => {
      clearTimeout(timer);
    };
  }, [guildId, previewQuery]);

  return (
    <form action={action} className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <input type="hidden" name="guildId" value={guildId} />

      <div className="flex flex-col gap-3 xl:sticky xl:top-24 xl:self-start">
        <div className="relative overflow-hidden rounded-m3-xl shadow-edge bg-surface">
          <img
            ref={image}
            src={previewSource}
            alt={`Preview of the ${kind} card`}
            width={1024}
            height={450}
            onLoad={() => {
              setLoadedSource(previewSource);
            }}
            onError={() => {
              setFailedSource(previewSource);
            }}
            className={`block aspect-[1024/450] w-full transition-opacity ${
              failed ? "invisible" : loading ? "opacity-60" : "opacity-100"
            }`}
          />
          {failed && (
            <p className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-muted">
              The preview could not be drawn. Reload the page; if it keeps failing, sign in again.
            </p>
          )}
          {loading && (
            <span className="absolute top-3 right-3 flex items-center gap-2 rounded-full bg-background/80 py-1 pr-3 pl-1.5 text-xs text-muted">
              <Loader className="size-4 text-primary" label="Updating preview" />
              Updating
            </span>
          )}
        </div>
        <div className="flex items-center justify-between gap-3">
          <div
            role="tablist"
            aria-label="Preview"
            className="flex gap-1 rounded-full bg-surface p-1"
          >
            {(["welcome", "goodbye"] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="tab"
                aria-selected={kind === option}
                onClick={() => {
                  setKind(option);
                }}
                className={`m3-button h-8 px-4 text-sm font-medium ${
                  kind === option
                    ? "bg-secondary-container text-on-secondary-container"
                    : "text-muted hover:text-on-surface"
                }`}
              >
                {option === "welcome" ? "Welcome" : "Goodbye"}
              </button>
            ))}
          </div>
          <p className="text-xs text-faint">Preview with your name and avatar</p>
        </div>
      </div>

      <div className="flex flex-col gap-6">
        <Group label="Send the card">
          {(
            [
              ["welcomeEnabled", "When a member joins", "Posted in the welcome channel."],
              ["goodbyeEnabled", "When a member leaves", "Posted in the goodbye channel."],
            ] as const
          ).map(([name, label, description]) => (
            <label
              key={name}
              className="flex cursor-pointer items-center justify-between gap-4 rounded-m3-lg bg-surface px-4 py-3"
            >
              <span>
                <span className="block font-medium">{label}</span>
                <span className="block text-sm text-muted">{description}</span>
              </span>
              <input
                type="checkbox"
                name={name}
                value="true"
                checked={values[name]}
                onChange={(event) => {
                  set(name, event.target.checked);
                }}
                className="m3-switch"
              />
            </label>
          ))}
        </Group>

        <Group label="Layout">
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ["centered", "Centered"],
                ["left", "Avatar left"],
              ] as const
            ).map(([id, label]) => (
              <label
                key={id}
                className={`flex cursor-pointer items-center justify-center gap-2 rounded-m3-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
                  values.layout === id
                    ? "border-transparent bg-secondary-container text-on-secondary-container"
                    : "border-outline text-muted hover:bg-surface"
                }`}
              >
                <input
                  type="radio"
                  name="layout"
                  value={id}
                  checked={values.layout === id}
                  onChange={() => {
                    set("layout", id);
                  }}
                  className="sr-only"
                />
                {values.layout === id && <Icon name="checkCircle" className="size-4" />}
                {label}
              </label>
            ))}
          </div>
        </Group>

        <Group label="Background">
          <div className="grid grid-cols-5 gap-2">
            {backgrounds.map((background) => (
              <label
                key={background.id}
                className="flex cursor-pointer flex-col items-center gap-1.5"
              >
                <input
                  type="radio"
                  name="background"
                  value={background.id}
                  checked={values.background === background.id}
                  onChange={() => {
                    set("background", background.id);
                  }}
                  className="peer sr-only"
                />
                <span
                  style={{ background: background.swatch }}
                  className="block aspect-[16/9] w-full rounded-m3-md ring-2 ring-transparent ring-offset-2 ring-offset-surface-low transition peer-checked:ring-primary peer-focus-visible:ring-primary/60"
                />
                <span className="text-xs text-muted">{background.label}</span>
              </label>
            ))}
            <label
              className={`flex flex-col items-center gap-1.5 ${hasBackgroundImage ? "cursor-pointer" : "cursor-not-allowed opacity-50"}`}
              title={hasBackgroundImage ? undefined : "Upload a picture below first"}
            >
              <input
                type="radio"
                name="background"
                value="image"
                disabled={!hasBackgroundImage}
                checked={values.background === "image"}
                onChange={() => {
                  set("background", "image");
                }}
                className="peer sr-only"
              />
              <span className="grid aspect-[16/9] w-full place-items-center rounded-m3-md bg-surface-highest ring-2 ring-transparent ring-offset-2 ring-offset-surface-low transition peer-checked:ring-primary">
                <Icon name="image" className="size-5 text-muted" />
              </span>
              <span className="text-xs text-muted">Picture</span>
            </label>
          </div>
        </Group>

        <Group label="Colours">
          <div className="grid gap-2 sm:grid-cols-2">
            <ColorField
              label="Accent"
              name="accentColor"
              value={values.accentColor}
              onChange={(value) => {
                set("accentColor", value);
              }}
            />
            <ColorField
              label="Text"
              name="textColor"
              value={values.textColor}
              onChange={(value) => {
                set("textColor", value);
              }}
            />
          </div>
          <label className="flex flex-col gap-2 rounded-m3-lg bg-surface px-4 py-3">
            <span className="flex justify-between text-sm">
              <span>Darken background</span>
              <span className="text-muted">{values.overlayOpacity}%</span>
            </span>
            <input
              type="range"
              name="overlayOpacity"
              min={0}
              max={80}
              step={5}
              value={values.overlayOpacity}
              onChange={(event) => {
                set("overlayOpacity", Number(event.target.value));
              }}
              className="accent-[var(--color-primary)]"
            />
          </label>
        </Group>

        <Group label="Texts">
          <p className="-mt-1 text-xs text-faint">
            Placeholders: {"{username}"}, {"{server}"}, {"{memberCount}"}. Up to 80 characters.
          </p>
          {(
            [
              ["welcomeTitle", "Welcome title", "welcome"],
              ["welcomeSubtitle", "Welcome subtitle", "welcome"],
              ["goodbyeTitle", "Goodbye title", "goodbye"],
              ["goodbyeSubtitle", "Goodbye subtitle", "goodbye"],
            ] as const
          ).map(([name, label, card]) => (
            <label key={name} className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium text-muted">{label}</span>
              <input
                name={name}
                value={values[name]}
                maxLength={80}
                onChange={(event) => {
                  set(name, event.target.value);
                }}
                onFocus={() => {
                  setKind(card);
                }}
                className={inputClass}
              />
            </label>
          ))}
        </Group>

        <div className="flex justify-end">
          <button type="submit" className={buttonClass("primary")}>
            <Icon name="checkCircle" className="-ml-1 size-[18px]" />
            Save card
          </button>
        </div>
      </div>
    </form>
  );
}
