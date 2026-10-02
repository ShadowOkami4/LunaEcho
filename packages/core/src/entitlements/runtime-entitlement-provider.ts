import type { RuntimeMode } from "../runtime/runtime-mode.js";
import type { Clock } from "../time/clock.js";
import type { EntitlementSnapshot, PlanId } from "./entitlement-model.js";
import type { EntitlementProvider } from "./entitlement-provider.js";
import { getPlanPolicy } from "./plan-catalog.js";

/** The plan every server gets in a deployment that has no billing yet. */
export const planForRuntimeMode = {
  "cloud-custom": "custom",
  "cloud-shared": "cloud",
  "self-hosted": "self-hosted",
} as const satisfies Readonly<Record<RuntimeMode, PlanId>>;

/**
 * Gives every server the same plan. Self-Hosted always works this way; Cloud and Custom do until
 * a private provider resolves plans from billing data.
 */
export class FixedPlanEntitlementProvider implements EntitlementProvider {
  public constructor(
    private readonly planId: PlanId,
    private readonly clock: Clock = () => new Date(),
  ) {}

  public resolveForGuild(guildId: string): Promise<EntitlementSnapshot> {
    const policy = getPlanPolicy(this.planId);

    return Promise.resolve({
      capabilities: new Set(policy.capabilities),
      evaluatedAt: this.clock(),
      guildId,
      planId: policy.id,
      quotas: policy.quotas,
    });
  }
}

export function createRuntimeEntitlementProvider(
  mode: RuntimeMode,
  clock?: Clock,
): FixedPlanEntitlementProvider {
  return new FixedPlanEntitlementProvider(planForRuntimeMode[mode], clock);
}
