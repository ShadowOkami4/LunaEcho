import type { Clock } from "../time/clock.js";
import type { EntitlementProvider } from "./entitlement-provider.js";
import type { EntitlementSnapshot } from "./entitlement-model.js";
import { getPlanPolicy } from "./plan-catalog.js";

export class SelfHostedEntitlementProvider implements EntitlementProvider {
  public constructor(private readonly clock: Clock = () => new Date()) {}

  public resolveForGuild(guildId: string): Promise<EntitlementSnapshot> {
    const policy = getPlanPolicy("self-hosted");

    return Promise.resolve({
      capabilities: new Set(policy.capabilities),
      evaluatedAt: this.clock(),
      guildId,
      planId: policy.id,
      quotas: policy.quotas,
    });
  }
}
