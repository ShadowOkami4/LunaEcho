import { describe, expect, it } from "vitest";

import {
  type CapabilityUnavailableError,
  type EntitlementProvider,
  EntitlementService,
  type EntitlementSnapshot,
  getPlanPolicy,
  type PlanId,
} from "../src/index.js";

class CatalogProvider implements EntitlementProvider {
  public constructor(private readonly planId: PlanId) {}

  public resolveForGuild(guildId: string): Promise<EntitlementSnapshot> {
    const policy = getPlanPolicy(this.planId);

    return Promise.resolve({
      capabilities: new Set(policy.capabilities),
      evaluatedAt: new Date("2026-01-01T00:00:00.000Z"),
      guildId,
      planId: policy.id,
      quotas: policy.quotas,
    });
  }
}

describe("EntitlementService", () => {
  it("allows capabilities included in the plan", async () => {
    const service = new EntitlementService(new CatalogProvider("cloud"));

    await expect(service.require("guild-1", "moderation")).resolves.toBeUndefined();
    await expect(service.canUse("guild-1", "tickets")).resolves.toBe(true);
  });

  it("rejects capabilities excluded from the plan", async () => {
    const service = new EntitlementService(new CatalogProvider("cloud"));

    await expect(service.require("guild-1", "music")).rejects.toMatchObject({
      capability: "music",
      code: "CAPABILITY_UNAVAILABLE",
      guildId: "guild-1",
      planId: "cloud",
    } satisfies Partial<CapabilityUnavailableError>);
  });

  it("returns quota limits from the entitlement snapshot", async () => {
    const selfHosted = new EntitlementService(new CatalogProvider("self-hosted"));
    const cloud = new EntitlementService(new CatalogProvider("cloud"));

    await expect(
      selfHosted.getQuota("guild-1", "stored-moderation-cases-per-guild"),
    ).resolves.toBeNull();
    await expect(cloud.getQuota("guild-1", "stored-moderation-cases-per-guild")).resolves.toBe(
      12_000,
    );
  });
});
