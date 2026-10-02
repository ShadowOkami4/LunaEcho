import { Loader } from "./loader";

/** Shown while a page loads: the loading indicator and shimmering stand-ins for the content. */
export function PageSkeleton({
  cards = 3,
  grid = false,
  label = "Loading",
}: Readonly<{ cards?: number; grid?: boolean; label?: string }>) {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <div className="flex items-center gap-3 text-sm text-muted">
        <Loader className="size-6 text-primary" label={label} />
        {label}
      </div>
      <div className={grid ? "grid gap-3 sm:grid-cols-2 xl:grid-cols-3" : "flex flex-col gap-4"}>
        {Array.from({ length: cards }, (_, index) => (
          <div
            key={index}
            className="skeleton flex flex-col gap-4 rounded-m3-xl p-6"
            style={{ animationDelay: `${index * 120}ms` }}
          >
            <div className="flex items-center gap-4">
              <div className="size-12 shrink-0 rounded-full bg-surface-highest/70" />
              <div className="flex flex-1 flex-col gap-2">
                <div className="h-4 w-2/5 rounded-full bg-surface-highest/70" />
                <div className="h-3 w-3/4 rounded-full bg-surface-highest/50" />
              </div>
            </div>
            {!grid && <div className="h-11 rounded-m3-md bg-surface-highest/50" />}
          </div>
        ))}
      </div>
    </div>
  );
}
