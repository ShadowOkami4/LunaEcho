import type { CSSProperties } from "react";

/** Staggers the `rise` entrance animation of an element. */
export function delay(milliseconds: number): CSSProperties {
  return { "--delay": `${milliseconds}ms` } as CSSProperties;
}
