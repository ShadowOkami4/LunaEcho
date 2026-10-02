/** The M3 Expressive loading indicator: a shape that morphs while it turns. */
export function Loader({
  className = "size-5",
  label = "Loading",
}: Readonly<{ className?: string; label?: string }>) {
  return <span role="progressbar" aria-label={label} className={`m3-loader ${className}`} />;
}
