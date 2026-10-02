import { iconPaths, type IconName } from "./icon-paths";

export type { IconName };

/** A Material Symbols Rounded icon. Decorative unless a label is given. */
export function Icon({
  className = "size-6",
  label,
  name,
}: Readonly<{ className?: string; label?: string; name: IconName }>) {
  return (
    <svg
      viewBox="0 -960 960 960"
      fill="currentColor"
      className={`shrink-0 ${className}`}
      {...(label === undefined ? { "aria-hidden": true } : { "aria-label": label, role: "img" })}
    >
      <path d={iconPaths[name]} />
    </svg>
  );
}
