import {
  capabilities,
  type Capability,
  type PlanId,
  type PlanPolicy,
  type QuotaKey,
  type QuotaLimit,
} from "./entitlement-model.js";

/** Measured upper bound for one stored moderation case, including its indexes. */
const bytesPerStoredModerationCase = 830;
const megabyte = 1_000_000;

/** The largest whole thousand of cases that fits the storage budget. */
function storedCasesWithin(budgetBytes: number): number {
  return Math.floor(budgetBytes / bytesPerStoredModerationCase / 1_000) * 1_000;
}

const unlimitedQuotas = {
  "stored-moderation-cases-per-guild": null,
} satisfies Readonly<Record<QuotaKey, QuotaLimit>>;

/**
 * Which modules Cloud withholds is a provisional product decision: Music, Automation, and Social
 * Notifications are not built, so their cost per server is still unknown.
 */
const cloudCapabilities = [
  "moderation",
  "onboarding",
  "roles",
  "tickets",
  "levels",
  "voice-rooms",
  "logs",
  "utilities",
] as const satisfies readonly Capability[];

/**
 * Product policy is intentionally centralized and can change without touching commands, event
 * handlers, or feature modules. Each managed quota is a storage budget per server divided by the
 * measured cost of one item; docs/tier-policy.md explains the budgets.
 */
export const planCatalog = {
  "self-hosted": {
    capabilities,
    id: "self-hosted",
    quotas: unlimitedQuotas,
  },
  cloud: {
    capabilities: cloudCapabilities,
    id: "cloud",
    quotas: {
      "stored-moderation-cases-per-guild": storedCasesWithin(10 * megabyte),
    },
  },
  custom: {
    capabilities,
    id: "custom",
    quotas: {
      "stored-moderation-cases-per-guild": storedCasesWithin(100 * megabyte),
    },
  },
} as const satisfies Readonly<Record<PlanId, PlanPolicy>>;

export function getPlanPolicy(planId: PlanId): PlanPolicy {
  return planCatalog[planId];
}
