import { describe, expect, it } from "vitest";

import {
  createRuntimeEntitlementProvider,
  runtimeModes,
  SelfHostedEntitlementProvider,
} from "../src/index.js";

describe("createRuntimeEntitlementProvider", () => {
  it("gives Cloud servers the Cloud plan, without Music, Automation, or Social", async () => {
    const snapshot = await createRuntimeEntitlementProvider("cloud-shared").resolveForGuild("g");

    expect(snapshot.planId).toBe("cloud");
    expect(snapshot.capabilities.has("moderation")).toBe(true);
    expect(snapshot.capabilities.has("music")).toBe(false);
    expect(snapshot.capabilities.has("automation")).toBe(false);
    expect(snapshot.capabilities.has("social-notifications")).toBe(false);
  });

  it("gives Custom and Self-Hosted servers every module", async () => {
    for (const mode of ["cloud-custom", "self-hosted"] as const) {
      const snapshot = await createRuntimeEntitlementProvider(mode).resolveForGuild("g");

      expect(snapshot.capabilities.has("music")).toBe(true);
      expect(snapshot.capabilities.has("automation")).toBe(true);
    }
  });

  it("covers every runtime mode, and the self-hosted provider still works on its own", async () => {
    for (const mode of runtimeModes) {
      await expect(
        createRuntimeEntitlementProvider(mode).resolveForGuild("g"),
      ).resolves.toBeDefined();
    }

    await expect(new SelfHostedEntitlementProvider().resolveForGuild("g")).resolves.toMatchObject({
      planId: "self-hosted",
    });
  });
});
