import { describe, expect, it } from "vitest";

import { capabilities, getPlanPolicy, moduleCatalog, moduleIds, planIds } from "../src/index.js";

describe("planCatalog", () => {
  it("defines every known plan", () => {
    for (const planId of planIds) {
      expect(getPlanPolicy(planId).id).toBe(planId);
    }
  });

  it("gives self-hosted and custom access to every capability", () => {
    expect(getPlanPolicy("self-hosted").capabilities).toEqual(capabilities);
    expect(getPlanPolicy("custom").capabilities).toEqual(capabilities);
  });

  it("keeps cloud resource limits finite", () => {
    const policy = getPlanPolicy("cloud");

    expect(policy.capabilities).not.toContain("music");
    expect(policy.capabilities).not.toContain("automation");
    expect(policy.capabilities).not.toContain("social-notifications");
    expect(Object.values(policy.quotas)).not.toContain(null);
  });
});

describe("moduleCatalog", () => {
  it("describes each version 1 module exactly once", () => {
    expect(moduleCatalog.map((module) => module.id)).toEqual(moduleIds);
    expect(moduleCatalog).toHaveLength(11);
  });

  it("switches on only the essential modules by default", () => {
    expect(
      moduleCatalog.filter((module) => module.enabledByDefault).map((module) => module.id),
    ).toEqual(["moderation", "logs"]);
  });
});
