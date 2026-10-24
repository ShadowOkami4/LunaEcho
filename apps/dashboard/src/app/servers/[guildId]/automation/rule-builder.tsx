"use client";

import { useState, type ReactNode } from "react";

import { Icon, type IconName } from "@/components/icon";
import { MultiSelectMenu, SelectMenu, type MenuOption } from "@/components/select-menu";
import { SubmitButton } from "@/components/submit-button";

import { inputClass } from "../styles";

type TriggerKind = "member-join" | "message-keyword" | "schedule";
type ActionKind = "add-role" | "react" | "remove-role" | "send-dm" | "send-message";

/** A rule as plain data, so a server page can hand it to this client component. */
export type RuleDraft = Readonly<{
  actions: readonly Readonly<{
    channelId?: string | null;
    emoji?: string;
    kind: ActionKind;
    roleId?: string;
    text?: string;
  }>[];
  conditions: Readonly<{
    channelIds: readonly string[];
    excludedRoleIds: readonly string[];
    requiredRoleIds: readonly string[];
  }>;
  cooldownSeconds: number;
  enabled: boolean;
  id?: string;
  intervalHours: number;
  keywords: readonly string[];
  match: "contains" | "exact";
  name: string;
  trigger: TriggerKind;
}>;

export const emptyRule: RuleDraft = {
  actions: [{ kind: "send-message" }],
  conditions: { channelIds: [], excludedRoleIds: [], requiredRoleIds: [] },
  cooldownSeconds: 60,
  enabled: true,
  intervalHours: 24,
  keywords: [],
  match: "contains",
  name: "",
  trigger: "message-keyword",
};

const maximumActions = 5;

const triggers: readonly Readonly<{
  hint: string;
  icon: IconName;
  id: TriggerKind;
  label: string;
}>[] = [
  { hint: "A message contains a word", icon: "chat", id: "message-keyword", label: "Keyword" },
  { hint: "Someone joins the server", icon: "personAdd", id: "member-join", label: "Member joins" },
  { hint: "Every few hours", icon: "schedule", id: "schedule", label: "Schedule" },
];

const actionKinds: readonly Readonly<{ icon: IconName; id: ActionKind; label: string }>[] = [
  { icon: "send", id: "send-message", label: "Send a message" },
  { icon: "mail", id: "send-dm", label: "Send a direct message" },
  { icon: "personAdd", id: "add-role", label: "Give a role" },
  { icon: "personRemove", id: "remove-role", label: "Take a role" },
  { icon: "addReaction", id: "react", label: "React with an emoji" },
];

/** Mirrors actionAllowed in the automation service: what each trigger can do. */
function allowedActions(trigger: TriggerKind): readonly ActionKind[] {
  switch (trigger) {
    case "schedule":
      return ["send-message"];
    case "member-join":
      return ["send-message", "send-dm", "add-role", "remove-role"];
    case "message-keyword":
      return ["send-message", "send-dm", "add-role", "remove-role", "react"];
  }
}

function Step({
  children,
  icon,
  number,
  title,
}: Readonly<{ children: ReactNode; icon: IconName; number: number; title: string }>) {
  return (
    <section className="flex gap-4">
      <div className="flex flex-col items-center">
        <span className="shape-cookie9 grid size-10 shrink-0 place-items-center icon-tile">
          <Icon name={icon} className="size-5" />
        </span>
        <span aria-hidden className="mt-2 w-px flex-1 bg-outline/60" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3 pb-6">
        <p className="title-medium pt-2">
          <span className="text-faint">{number}. </span>
          {title}
        </p>
        {children}
      </div>
    </section>
  );
}

/** Keywords as chips: type and press Enter or a comma to add one. */
function KeywordInput({
  keywords,
  onChange,
}: Readonly<{ keywords: readonly string[]; onChange: (keywords: readonly string[]) => void }>) {
  const [draft, setDraft] = useState("");
  const add = (value: string) => {
    const keyword = value.trim().toLowerCase();

    if (keyword !== "" && !keywords.includes(keyword) && keywords.length < 20) {
      onChange([...keywords, keyword]);
    }

    setDraft("");
  };

  return (
    <div className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-m3-md border-b-2 border-outline-strong/60 bg-surface-highest p-1.5">
      <input type="hidden" name="keywords" value={keywords.join(",")} />
      {keywords.map((keyword) => (
        <span
          key={keyword}
          className="inline-flex h-8 items-center gap-1 rounded-m3-sm border border-outline bg-surface pr-1 pl-2.5 text-sm"
        >
          {keyword}
          <button
            type="button"
            aria-label={`Remove ${keyword}`}
            onClick={() => {
              onChange(keywords.filter((candidate) => candidate !== keyword));
            }}
            className="grid size-6 place-items-center rounded-full text-muted hover:bg-danger-container hover:text-on-danger-container"
          >
            <Icon name="close" className="size-4" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        aria-label="Add a keyword"
        placeholder={keywords.length === 0 ? "Type a word and press Enter" : "Add another"}
        onChange={(event) => {
          const value = event.target.value;

          if (value.endsWith(",")) {
            add(value.slice(0, -1));
          } else {
            setDraft(value);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            add(draft);
          } else if (event.key === "Backspace" && draft === "" && keywords.length > 0) {
            onChange(keywords.slice(0, -1));
          }
        }}
        onBlur={() => {
          add(draft);
        }}
        className="min-w-40 flex-1 bg-transparent px-2 text-sm placeholder:text-faint focus:outline-none"
      />
    </div>
  );
}

function Label({ children }: Readonly<{ children: ReactNode }>) {
  return <span className="text-sm font-medium text-muted">{children}</span>;
}

/**
 * Builds an automation rule step by step: when it runs, optional conditions, and what it does.
 * Only the fields that matter for the current choices are shown.
 */
export function RuleBuilder({
  action,
  channels,
  guildId,
  initial,
  roles,
}: Readonly<{
  action: (formData: FormData) => Promise<void>;
  channels: readonly MenuOption[];
  guildId: string;
  initial: RuleDraft;
  roles: readonly MenuOption[];
}>) {
  const [trigger, setTrigger] = useState<TriggerKind>(initial.trigger);
  const [keywords, setKeywords] = useState<readonly string[]>(initial.keywords);
  const [match, setMatch] = useState(initial.match);
  const [actions, setActions] = useState(
    initial.actions.map((entry, index) => ({ ...entry, key: index })),
  );
  const [nextKey, setNextKey] = useState(initial.actions.length);
  const conditionCount =
    initial.conditions.channelIds.length +
    initial.conditions.requiredRoleIds.length +
    initial.conditions.excludedRoleIds.length;
  const allowed = allowedActions(trigger);
  const prefix = initial.id ?? "new";

  const changeTrigger = (next: TriggerKind) => {
    setTrigger(next);
    // Drop actions the new trigger cannot run, but always keep one to fill in.
    setActions((current) => {
      const kept = current.filter((entry) => allowedActions(next).includes(entry.kind));
      return kept.length > 0 ? kept : [{ key: nextKey, kind: "send-message" }];
    });
    setNextKey((key) => key + 1);
  };

  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="guildId" value={guildId} />
      {initial.id !== undefined && <input type="hidden" name="ruleId" value={initial.id} />}
      <input type="hidden" name="trigger" value={trigger} />

      <div className="flex flex-col gap-3 pb-4 sm:flex-row sm:items-end">
        <label className="flex flex-1 flex-col gap-1.5">
          <Label>Rule name</Label>
          <input
            name="name"
            required
            maxLength={80}
            defaultValue={initial.name}
            placeholder="For example: Greet new members"
            className={inputClass}
          />
        </label>
        <label className="flex h-11 cursor-pointer items-center gap-3 rounded-m3-lg bg-surface px-4">
          <span className="text-sm font-medium">Rule is on</span>
          <input
            type="checkbox"
            name="enabled"
            value="true"
            defaultChecked={initial.enabled}
            className="m3-switch"
          />
        </label>
      </div>

      <Step icon="bolt" number={1} title="When">
        <div role="radiogroup" aria-label="Trigger" className="grid gap-2 sm:grid-cols-3">
          {triggers.map((option) => {
            const selected = trigger === option.id;

            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => {
                  changeTrigger(option.id);
                }}
                className={`m3-card flex items-center gap-3 border p-3 text-left transition-colors ${
                  selected
                    ? "border-primary/60 bg-secondary-container text-on-secondary-container"
                    : "border-outline/60 bg-surface hover:bg-surface-high"
                }`}
              >
                <Icon name={option.icon} className="size-6 shrink-0" />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{option.label}</span>
                  <span className={`block text-xs ${selected ? "opacity-80" : "text-muted"}`}>
                    {option.hint}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {trigger === "message-keyword" && (
          <div className="flex flex-col gap-3">
            <KeywordInput keywords={keywords} onChange={setKeywords} />
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted">Matches when the message</span>
              <input type="hidden" name="match" value={match} />
              {(
                [
                  ["contains", "contains a keyword"],
                  ["exact", "is exactly a keyword"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={match === id}
                  onClick={() => {
                    setMatch(id);
                  }}
                  className={`m3-button h-8 px-3 text-sm font-medium ${
                    match === id
                      ? "bg-secondary-container text-on-secondary-container"
                      : "border border-outline text-muted"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {trigger === "schedule" && (
          <label className="flex items-center gap-3 text-sm">
            <span className="text-muted">Every</span>
            <input
              type="number"
              name="intervalHours"
              min={1}
              max={168}
              defaultValue={initial.intervalHours}
              className={`${inputClass} w-24`}
            />
            <span className="text-muted">hours (1 to 168)</span>
          </label>
        )}

        {trigger === "member-join" && (
          <p className="text-sm text-muted">Runs once for every member who joins, not for bots.</p>
        )}
      </Step>

      <Step icon="filterAlt" number={2} title="Only if (optional)">
        <details open={conditionCount > 0} className="rounded-m3-lg bg-surface">
          <summary className="flex cursor-pointer items-center gap-2 rounded-m3-lg px-4 py-3 text-sm">
            <span className="flex-1">
              {conditionCount === 0
                ? "Runs for everyone, everywhere"
                : `${conditionCount} condition${conditionCount === 1 ? "" : "s"} set`}
            </span>
            <span className="text-primary">Edit</span>
            <Icon name="expandMore" className="m3-chevron size-5 text-muted" />
          </summary>
          <div className="grid gap-3 px-4 pb-4 sm:grid-cols-2">
            {trigger === "message-keyword" && (
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label>Only in these channels</Label>
                <MultiSelectMenu
                  addLabel="Add channel"
                  emptyLabel="Every channel"
                  defaultValue={initial.conditions.channelIds}
                  label="Only in these channels"
                  name="channelIds"
                  options={channels}
                  prefix="#"
                />
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Label>Member must have</Label>
              <MultiSelectMenu
                addLabel="Add role"
                emptyLabel="No requirement"
                defaultValue={initial.conditions.requiredRoleIds}
                label="Member must have"
                name="requiredRoleIds"
                options={roles}
                prefix="@"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Member must not have</Label>
              <MultiSelectMenu
                addLabel="Add role"
                emptyLabel="No exclusion"
                defaultValue={initial.conditions.excludedRoleIds}
                label="Member must not have"
                name="excludedRoleIds"
                options={roles}
                prefix="@"
              />
            </div>
            <label className="flex flex-col gap-1.5">
              <Label>Cooldown per member (seconds)</Label>
              <input
                type="number"
                name="cooldownSeconds"
                min={0}
                max={86400}
                defaultValue={initial.cooldownSeconds}
                className={inputClass}
              />
              <span className="text-xs text-faint">0 means the rule can run every time.</span>
            </label>
          </div>
        </details>
      </Step>

      <Step icon="send" number={3} title="Then">
        <ol className="flex flex-col gap-2">
          {actions.map((entry, slot) => {
            const field = (name: string) => `action-${slot}-${name}`;
            const kind = actionKinds.find((option) => option.id === entry.kind) ?? actionKinds[0];

            return (
              <li key={entry.key} className="rise flex flex-col gap-3 rounded-m3-lg bg-surface p-3">
                <div className="flex items-center gap-2">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-highest text-xs font-semibold text-muted">
                    {slot + 1}
                  </span>
                  <select
                    name={field("kind")}
                    value={entry.kind}
                    aria-label={`Action ${slot + 1}`}
                    onChange={(event) => {
                      const next = event.target.value as ActionKind;
                      setActions((current) =>
                        current.map((candidate) =>
                          candidate.key === entry.key
                            ? { key: candidate.key, kind: next }
                            : candidate,
                        ),
                      );
                    }}
                    className={`${inputClass} flex-1`}
                  >
                    {actionKinds
                      .filter((option) => allowed.includes(option.id))
                      .map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                  </select>
                  {actions.length > 1 && (
                    <button
                      type="button"
                      aria-label={`Remove action ${slot + 1}`}
                      onClick={() => {
                        setActions((current) =>
                          current.filter((candidate) => candidate.key !== entry.key),
                        );
                      }}
                      className="grid size-10 shrink-0 place-items-center rounded-full text-muted hover:bg-danger-container hover:text-on-danger-container"
                    >
                      <Icon name="delete" className="size-5" />
                    </button>
                  )}
                </div>

                {kind?.id === "send-message" && (
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
                    <SelectMenu
                      key={`${prefix}-${entry.key}-${trigger}`}
                      label="Channel"
                      name={field("channel")}
                      defaultValue={entry.channelId ?? null}
                      options={channels}
                      prefix="#"
                      {...(trigger === "message-keyword" ? { none: "Same channel" } : {})}
                    />
                    <input
                      name={field("text")}
                      required
                      maxLength={1500}
                      defaultValue={entry.text ?? ""}
                      placeholder="Message, for example: Welcome {user}!"
                      aria-label="Message"
                      className={inputClass}
                    />
                  </div>
                )}
                {kind?.id === "send-dm" && (
                  <input
                    name={field("text")}
                    required
                    maxLength={1500}
                    defaultValue={entry.text ?? ""}
                    placeholder="Direct message, for example: Thanks for joining {server}!"
                    aria-label="Direct message"
                    className={inputClass}
                  />
                )}
                {(kind?.id === "add-role" || kind?.id === "remove-role") && (
                  <SelectMenu
                    label="Role"
                    name={field("role")}
                    defaultValue={entry.roleId ?? null}
                    options={roles}
                    prefix="@"
                  />
                )}
                {kind?.id === "react" && (
                  <input
                    name={field("emoji")}
                    required
                    defaultValue={entry.emoji ?? ""}
                    placeholder="An emoji, or a custom one as <:name:id>"
                    aria-label="Emoji"
                    className={inputClass}
                  />
                )}
              </li>
            );
          })}
        </ol>
        <div className="flex flex-wrap items-center justify-between gap-2">
          {actions.length < maximumActions ? (
            <button
              type="button"
              onClick={() => {
                setActions((current) => [
                  ...current,
                  { key: nextKey, kind: allowed[0] ?? "send-message" },
                ]);
                setNextKey((key) => key + 1);
              }}
              className="m3-button inline-flex h-9 items-center gap-1 px-3 text-sm font-semibold text-primary"
            >
              <Icon name="add" className="size-[18px]" />
              Add action
            </button>
          ) : (
            <span className="text-xs text-faint">
              A rule can have up to {maximumActions} actions.
            </span>
          )}
          <span className="text-xs text-faint">
            Placeholders: {"{user}"}, {"{username}"}, {"{server}"}, {"{channel}"}
          </span>
        </div>
      </Step>

      <div className="flex justify-end">
        <SubmitButton icon="checkCircle">
          {initial.id === undefined ? "Create rule" : "Save rule"}
        </SubmitButton>
      </div>
    </form>
  );
}
