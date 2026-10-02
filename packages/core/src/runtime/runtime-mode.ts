/**
 * Self-Hosted, Cloud, and Custom are deployment choices of one codebase, not separate bots.
 * The mode decides who hosts LunaEcho and which Discord bot identity it uses.
 */
export const runtimeModes = ["self-hosted", "cloud-shared", "cloud-custom"] as const;

export type RuntimeMode = (typeof runtimeModes)[number];

export const runtimeModeNames = {
  "cloud-custom": "Custom",
  "cloud-shared": "Cloud",
  "self-hosted": "Self-Hosted",
} as const satisfies Readonly<Record<RuntimeMode, string>>;
