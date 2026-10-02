const units = { d: 86_400_000, h: 3_600_000, m: 60_000, s: 1_000, w: 604_800_000 } as const;

/**
 * Parses durations such as `10m`, `2h`, `1h30m`, or `1w 2d`. Returns undefined for anything
 * else, including zero, so callers can show one clear error.
 */
export function parseDuration(input: string): number | undefined {
  const compact = input.trim().toLowerCase().replace(/\s+/gu, "");

  if (!/^(?:\d+[wdhms])+$/u.test(compact)) {
    return undefined;
  }

  let total = 0;

  for (const [, amount, unit] of compact.matchAll(/(\d+)([wdhms])/gu)) {
    total += Number(amount) * units[unit as keyof typeof units];
  }

  return total > 0 && Number.isSafeInteger(total) ? total : undefined;
}
