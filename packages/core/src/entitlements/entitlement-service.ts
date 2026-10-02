import type { EntitlementProvider } from "./entitlement-provider.js";
import type { Capability, EntitlementSnapshot, QuotaKey, QuotaLimit } from "./entitlement-model.js";

export class CapabilityUnavailableError extends Error {
  public readonly code = "CAPABILITY_UNAVAILABLE";

  public constructor(
    public readonly guildId: string,
    public readonly capability: Capability,
    public readonly planId: EntitlementSnapshot["planId"],
  ) {
    super(`Capability '${capability}' is unavailable for plan '${planId}'`);
    this.name = "CapabilityUnavailableError";
  }
}

export class EntitlementService {
  public constructor(private readonly provider: EntitlementProvider) {}

  public async canUse(guildId: string, capability: Capability): Promise<boolean> {
    const entitlement = await this.resolveForGuild(guildId);
    return entitlement.capabilities.has(capability);
  }

  public async getQuota(guildId: string, quota: QuotaKey): Promise<QuotaLimit> {
    const entitlement = await this.resolveForGuild(guildId);
    return entitlement.quotas[quota];
  }

  public async require(guildId: string, capability: Capability): Promise<void> {
    const entitlement = await this.resolveForGuild(guildId);

    if (!entitlement.capabilities.has(capability)) {
      throw new CapabilityUnavailableError(guildId, capability, entitlement.planId);
    }
  }

  public resolveForGuild(guildId: string): Promise<EntitlementSnapshot> {
    return this.provider.resolveForGuild(guildId);
  }
}
