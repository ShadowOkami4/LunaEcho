import { moduleIds, type ModuleId } from "../modules/module-catalog.js";

/** Every module is one capability, so plans grant or withhold whole modules. */
export const capabilities = moduleIds;

export type Capability = ModuleId;

/**
 * A quota exists only for a resource whose cost has been measured; see
 * docs/resource-measurements.md. A module adds its quotas when it is built and measured.
 */
export const quotaKeys = ["stored-moderation-cases-per-guild"] as const;

export type QuotaKey = (typeof quotaKeys)[number];

export const planIds = ["self-hosted", "cloud", "custom"] as const;

export type PlanId = (typeof planIds)[number];

export const planNames = {
  cloud: "Cloud",
  custom: "Custom",
  "self-hosted": "Self-Hosted",
} as const satisfies Readonly<Record<PlanId, string>>;

/** A null quota is controlled by the deployment's own infrastructure, not LunaEcho. */
export type QuotaLimit = number | null;

export type PlanPolicy = Readonly<{
  capabilities: readonly Capability[];
  id: PlanId;
  quotas: Readonly<Record<QuotaKey, QuotaLimit>>;
}>;

export type EntitlementSnapshot = Readonly<{
  capabilities: ReadonlySet<Capability>;
  evaluatedAt: Date;
  guildId: string;
  planId: PlanId;
  quotas: Readonly<Record<QuotaKey, QuotaLimit>>;
}>;
