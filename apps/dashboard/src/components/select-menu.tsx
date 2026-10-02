"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";

import { Icon } from "./icon";

/** A channel or a role. `type` is the Discord channel type; `color` the role colour. */
export type MenuOption = Readonly<{ color?: number; id: string; name: string; type?: number }>;

const channelTypes = { category: 4, voice: 2 } as const;
/** Lists longer than this get a search field. */
const searchThreshold = 8;

function colorOf(color: number | undefined): string | undefined {
  return color === undefined || color === 0 ? undefined : `#${color.toString(16).padStart(6, "0")}`;
}

/** The leading mark of an option: a channel icon, or a role's colour dot. */
function OptionMark({ option, prefix }: Readonly<{ option: MenuOption; prefix: string }>) {
  // The "none" entry is not a channel or role, so it gets no mark.
  if (option.id === "") {
    return null;
  }

  if (prefix === "@") {
    return (
      <span
        aria-hidden
        className="size-3 shrink-0 rounded-full border border-outline-strong/50"
        style={{ background: colorOf(option.color) ?? "var(--color-outline-strong)" }}
      />
    );
  }

  if (prefix === "#") {
    const icon =
      option.type === channelTypes.voice
        ? "headphones"
        : option.type === channelTypes.category
          ? "folder"
          : "tag";
    return <Icon name={icon} className="size-[18px] text-muted" />;
  }

  return null;
}

/** Shared popover list: search, keyboard navigation, outside click and Escape close it. */
function useMenu(options: readonly MenuOption[], onPick: (option: MenuOption) => void) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle === ""
      ? options
      : options.filter((option) => option.name.toLowerCase().includes(needle));
  }, [options, query]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const close = (event: MouseEvent) => {
      if (root.current !== null && !root.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => {
      document.removeEventListener("mousedown", close);
    };
  }, [open]);

  const toggle = (next = !open) => {
    setOpen(next);
    setQuery("");
    setActive(0);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }

    if (!open && (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      toggle(true);
      return;
    }

    if (!open) {
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current) => (current + step + visible.length) % Math.max(1, visible.length));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const option = visible[active];

      if (option !== undefined) {
        onPick(option);
      }
    }
  };

  return {
    active,
    listId,
    onKeyDown,
    open,
    query,
    root,
    setActive,
    setOpen,
    setQuery,
    toggle,
    visible,
  };
}

function Popover({
  menu,
  prefix,
  renderSelected,
  onPick,
  emptyText,
}: Readonly<{
  emptyText: string;
  menu: ReturnType<typeof useMenu>;
  onPick: (option: MenuOption) => void;
  prefix: string;
  renderSelected: (option: MenuOption) => boolean;
}>) {
  const options = menu.visible;

  return (
    <div className="menu-open absolute top-full right-0 left-0 z-30 mt-1 overflow-hidden rounded-m3-lg border border-outline/60 bg-surface-high shadow-[0_12px_32px_rgb(0_0_0/0.4)]">
      {menu.visible.length > searchThreshold || menu.query !== "" ? (
        <div className="flex items-center gap-2 border-b border-outline/60 px-3">
          <Icon name="search" className="size-[18px] text-muted" />
          <input
            autoFocus
            value={menu.query}
            onChange={(event) => {
              menu.setQuery(event.target.value);
              menu.setActive(0);
            }}
            onKeyDown={menu.onKeyDown}
            placeholder="Search"
            aria-label="Search"
            className="menu-search h-11 flex-1 bg-transparent text-sm placeholder:text-faint"
          />
        </div>
      ) : null}
      <ul id={menu.listId} role="listbox" className="max-h-72 overflow-y-auto py-1">
        {options.length === 0 && <li className="px-4 py-3 text-sm text-muted">{emptyText}</li>}
        {options.map((option, index) => {
          const selected = renderSelected(option);

          return (
            <li
              key={option.id}
              role="option"
              aria-selected={selected}
              onMouseEnter={() => {
                menu.setActive(index);
              }}
              onMouseDown={(event) => {
                // Keeps focus in the menu so the click is not lost to a blur.
                event.preventDefault();
                onPick(option);
              }}
              className={`flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm ${
                index === menu.active ? "bg-on-surface/8" : ""
              } ${selected ? "font-semibold text-on-secondary-container" : ""}`}
            >
              <OptionMark option={option} prefix={prefix} />
              <span className="min-w-0 flex-1 truncate">{option.name}</span>
              {selected && <Icon name="check" className="size-[18px] text-primary" />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Fields wrap their control in a <label>, and a click on a label's plain text "clicks" the first
 * button inside it, which could remove a chip by accident. Clicks that are not on a button or
 * an input stop that default here.
 */
function keepLabelClicksLocal(event: ReactMouseEvent): void {
  if (!(event.target as Element).closest("button, input")) {
    event.preventDefault();
  }
}

const triggerClass =
  "flex min-h-11 w-full items-center gap-2 rounded-m3-md border-b-2 border-outline-strong/60 bg-surface-highest px-3.5 py-2 text-left text-sm transition-colors hover:bg-surface-bright focus-visible:border-primary focus-visible:outline-none disabled:cursor-not-allowed";

/** A single choice; with `none`, the first entry clears the choice. */
export function SelectMenu({
  defaultValue,
  label,
  name,
  none,
  options,
  prefix = "",
}: Readonly<{
  defaultValue: string | null;
  label?: string;
  name: string;
  none?: string;
  options: readonly MenuOption[];
  prefix?: string;
}>) {
  const [value, setValue] = useState<string>(
    defaultValue ?? (none === undefined ? (options[0]?.id ?? "") : ""),
  );
  const all = useMemo(
    () => (none === undefined ? options : [{ id: "", name: none }, ...options]),
    [none, options],
  );
  const menu = useMenu(all, (option) => {
    setValue(option.id);
    menu.setOpen(false);
  });
  const current = options.find((option) => option.id === value);

  return (
    <div ref={menu.root} onClick={keepLabelClicksLocal} className="relative">
      <input type="hidden" name={name} value={value} />
      <button
        type="button"
        role="combobox"
        aria-label={label}
        aria-expanded={menu.open}
        aria-controls={menu.listId}
        onClick={() => {
          menu.toggle();
        }}
        onKeyDown={menu.onKeyDown}
        className={triggerClass}
      >
        {current === undefined ? (
          <span className="flex-1 text-muted">{none ?? "Choose"}</span>
        ) : (
          <>
            <OptionMark option={current} prefix={prefix} />
            <span className="min-w-0 flex-1 truncate">{current.name}</span>
          </>
        )}
        <Icon
          name="expandMore"
          className={`size-5 text-muted transition-transform ${menu.open ? "rotate-180" : ""}`}
        />
      </button>
      {menu.open && (
        <Popover
          menu={menu}
          prefix={prefix}
          emptyText="Nothing matches."
          onPick={(option) => {
            setValue(option.id);
            menu.setOpen(false);
          }}
          renderSelected={(option) => option.id === value}
        />
      )}
    </div>
  );
}

/** Several choices as removable chips, with a searchable menu to add more. */
export function MultiSelectMenu({
  addLabel = "Add",
  defaultValue,
  emptyLabel = "None selected",
  label,
  maximum,
  name,
  options,
  prefix = "",
}: Readonly<{
  addLabel?: string;
  defaultValue: readonly string[];
  emptyLabel?: string;
  label?: string;
  maximum?: number;
  name: string;
  options: readonly MenuOption[];
  prefix?: string;
}>) {
  const [values, setValues] = useState<readonly string[]>(
    defaultValue.filter((id) => options.some((option) => option.id === id)),
  );
  const toggleValue = (option: MenuOption) => {
    setValues((current) =>
      current.includes(option.id)
        ? current.filter((id) => id !== option.id)
        : maximum !== undefined && current.length >= maximum
          ? current
          : [...current, option.id],
    );
  };
  const menu = useMenu(options, toggleValue);
  const chosen = values
    .map((id) => options.find((option) => option.id === id))
    .filter((option): option is MenuOption => option !== undefined);
  const full = maximum !== undefined && values.length >= maximum;

  return (
    <div ref={menu.root} onClick={keepLabelClicksLocal} className="relative flex flex-col gap-2">
      {values.map((id) => (
        <input key={id} type="hidden" name={name} value={id} />
      ))}
      <div className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-m3-md border-b-2 border-outline-strong/60 bg-surface-highest p-1.5">
        {chosen.length === 0 && <span className="px-2 text-sm text-faint">{emptyLabel}</span>}
        {chosen.map((option) => (
          <Chip key={option.id}>
            <OptionMark option={option} prefix={prefix} />
            <span className="max-w-48 truncate">{option.name}</span>
            <button
              type="button"
              aria-label={`Remove ${option.name}`}
              onClick={() => {
                toggleValue(option);
              }}
              className="grid size-6 place-items-center rounded-full text-muted hover:bg-danger-container hover:text-on-danger-container"
            >
              <Icon name="close" className="size-4" />
            </button>
          </Chip>
        ))}
        <button
          type="button"
          aria-expanded={menu.open}
          aria-controls={menu.listId}
          aria-label={label === undefined ? addLabel : `${addLabel} to ${label}`}
          disabled={full}
          title={full ? `At most ${maximum}` : undefined}
          onClick={() => {
            menu.toggle();
          }}
          onKeyDown={menu.onKeyDown}
          className="m3-button inline-flex h-8 items-center gap-1 px-3 text-sm font-semibold text-primary hover:bg-primary/8 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Icon name="add" className="size-[18px]" />
          {addLabel}
        </button>
      </div>
      {menu.open && (
        <Popover
          menu={menu}
          prefix={prefix}
          emptyText="Nothing matches."
          onPick={toggleValue}
          renderSelected={(option) => values.includes(option.id)}
        />
      )}
      {maximum !== undefined && (
        <span className="text-xs text-faint">
          {values.length} of {maximum} selected
        </span>
      )}
    </div>
  );
}

function Chip({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <span className="inline-flex h-8 items-center gap-1.5 rounded-m3-sm border border-outline bg-surface pr-1 pl-2.5 text-sm">
      {children}
    </span>
  );
}
