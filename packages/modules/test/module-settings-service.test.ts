import type { ModuleDescriptor } from "@lunaecho/core";
import { describe, expect, it } from "vitest";

import { createTestModuleService, InMemoryModuleSettingsRepository } from "../src/testing.js";

/** Every real module is implemented by now; this catalog keeps one planned for the tests. */
const catalogWithPlannedModule: readonly ModuleDescriptor[] = [
  {
    description: "Essential",
    displayName: "Moderation & Safety",
    enabledByDefault: true,
    id: "moderation",
    status: "available",
  },
  {
    description: "Later",
    displayName: "Tickets",
    enabledByDefault: false,
    id: "tickets",
    status: "planned",
  },
];

/** A catalog with one essential and one optional module. */
const catalogWithOptionalModule: readonly ModuleDescriptor[] = [
  {
    description: "Essential",
    displayName: "Moderation & Safety",
    enabledByDefault: true,
    id: "moderation",
    status: "available",
  },
  {
    description: "Optional",
    displayName: "Music",
    enabledByDefault: false,
    id: "music",
    status: "available",
  },
];

describe("ModuleSettingsService", () => {
  it("runs essential modules by default and never runs planned ones", async () => {
    const service = createTestModuleService({ catalog: catalogWithPlannedModule });

    await expect(service.isEnabled("guild-1", "moderation")).resolves.toBe(true);
    await expect(service.isEnabled("guild-1", "tickets")).resolves.toBe(false);
  });

  it("keeps implemented optional modules off until an administrator enables them", async () => {
    const service = createTestModuleService({ catalog: catalogWithOptionalModule });

    await expect(service.isEnabled("guild-1", "music")).resolves.toBe(false);
    await expect(service.setEnabled("guild-1", "music", false, "admin-1")).resolves.toBe(
      "unchanged",
    );
    await expect(service.setEnabled("guild-1", "music", true, "admin-1")).resolves.toBe("updated");
    await expect(service.isEnabled("guild-1", "music")).resolves.toBe(true);
    await expect(service.isEnabled("guild-2", "music")).resolves.toBe(false);
  });

  it("switches a module per guild and reports unchanged requests", async () => {
    const service = createTestModuleService();

    await expect(service.setEnabled("guild-1", "moderation", false, "admin-1")).resolves.toBe(
      "updated",
    );
    await expect(service.setEnabled("guild-1", "moderation", false, "admin-1")).resolves.toBe(
      "unchanged",
    );
    await expect(service.isEnabled("guild-1", "moderation")).resolves.toBe(false);
    await expect(service.isEnabled("guild-2", "moderation")).resolves.toBe(true);

    await expect(service.setEnabled("guild-1", "moderation", true, "admin-1")).resolves.toBe(
      "updated",
    );
    await expect(service.isEnabled("guild-1", "moderation")).resolves.toBe(true);
  });

  it("refuses to switch modules that are not implemented yet", async () => {
    const service = createTestModuleService({ catalog: catalogWithPlannedModule });

    await expect(service.setEnabled("guild-1", "tickets", true, "admin-1")).resolves.toBe(
      "not-available",
    );
  });

  it("lists every catalog module with its state", async () => {
    const service = createTestModuleService();
    await service.setEnabled("guild-1", "moderation", false, "admin-1");

    const states = await service.getStates("guild-1");
    expect(states).toHaveLength(11);
    expect(states.find((state) => state.module.id === "moderation")?.enabled).toBe(false);
  });

  it("caches switches until they expire", async () => {
    let now = new Date("2026-01-01T00:00:00.000Z");
    const repository = new InMemoryModuleSettingsRepository();
    const service = createTestModuleService({ clock: () => now }, repository);

    await service.isEnabled("guild-1", "moderation");
    await service.isEnabled("guild-1", "moderation");
    expect(repository.listCalls).toBe(1);

    now = new Date("2026-01-01T00:00:31.000Z");
    await service.isEnabled("guild-1", "moderation");
    expect(repository.listCalls).toBe(2);
  });

  it("forgets the least recently loaded guild once the cache is full", async () => {
    const repository = new InMemoryModuleSettingsRepository();
    const service = createTestModuleService({ maximumCachedGuilds: 2 }, repository);

    await service.isEnabled("guild-1", "moderation");
    await service.isEnabled("guild-2", "moderation");
    await service.isEnabled("guild-3", "moderation");
    expect(repository.listCalls).toBe(3);

    await service.isEnabled("guild-3", "moderation");
    expect(repository.listCalls).toBe(3);
    await service.isEnabled("guild-1", "moderation");
    expect(repository.listCalls).toBe(4);
  });
});
