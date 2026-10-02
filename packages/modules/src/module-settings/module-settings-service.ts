import {
  ExpiringCache,
  moduleCatalog,
  type Clock,
  type ModuleDescriptor,
  type ModuleId,
} from "@lunaecho/core";

import type { ModuleSettingsRepository } from "./module-settings-repository.js";

/** Answers whether a module currently runs in a guild. */
export interface ModuleGate {
  isEnabled(guildId: string, moduleId: ModuleId): Promise<boolean>;
}

export type ModuleState = Readonly<{
  enabled: boolean;
  module: ModuleDescriptor;
}>;

export type ModuleToggleResult = "not-available" | "unchanged" | "updated";

export type ModuleSettingsOptions = Readonly<{
  cacheTtlMilliseconds?: number;
  catalog?: readonly ModuleDescriptor[];
  clock?: Clock;
  /** One cached guild costs about 235 bytes, so the default bounds this cache near 2.5 MB. */
  maximumCachedGuilds?: number;
}>;

export class ModuleSettingsService implements ModuleGate {
  private readonly catalog: readonly ModuleDescriptor[];
  private readonly clock: Clock;
  private readonly overridesCache: ExpiringCache<string, ReadonlyMap<ModuleId, boolean>>;

  public constructor(
    private readonly repository: ModuleSettingsRepository,
    options: ModuleSettingsOptions = {},
  ) {
    this.catalog = options.catalog ?? moduleCatalog;
    this.clock = options.clock ?? (() => new Date());
    this.overridesCache = new ExpiringCache({
      clock: this.clock,
      maximumEntries: options.maximumCachedGuilds ?? 10_000,
      ttlMilliseconds: options.cacheTtlMilliseconds ?? 30_000,
    });
  }

  /** Drops the cached switches, for example after the dashboard changed them. */
  public invalidate(guildId: string): void {
    this.overridesCache.delete(guildId);
  }

  public async getStates(guildId: string): Promise<readonly ModuleState[]> {
    const overrides = await this.getOverrides(guildId);

    return this.catalog.map((module) => ({
      enabled: resolveEnabled(module, overrides),
      module,
    }));
  }

  public async isEnabled(guildId: string, moduleId: ModuleId): Promise<boolean> {
    return resolveEnabled(this.requireModule(moduleId), await this.getOverrides(guildId));
  }

  public async setEnabled(
    guildId: string,
    moduleId: ModuleId,
    enabled: boolean,
    actorId: string,
  ): Promise<ModuleToggleResult> {
    if (this.requireModule(moduleId).status !== "available") {
      return "not-available";
    }

    if ((await this.isEnabled(guildId, moduleId)) === enabled) {
      return "unchanged";
    }

    await this.repository.setEnabled(guildId, moduleId, enabled, actorId, this.clock());
    this.overridesCache.delete(guildId);
    return "updated";
  }

  private async getOverrides(guildId: string): Promise<ReadonlyMap<ModuleId, boolean>> {
    const cached = this.overridesCache.get(guildId);

    if (cached !== undefined) {
      return cached;
    }

    const overrides = await this.repository.listOverrides(guildId);
    this.overridesCache.set(guildId, overrides);
    return overrides;
  }

  private requireModule(moduleId: ModuleId): ModuleDescriptor {
    const module = this.catalog.find((candidate) => candidate.id === moduleId);

    if (module === undefined) {
      throw new TypeError(`Module '${moduleId}' is missing from the module catalog`);
    }

    return module;
  }
}

function resolveEnabled(
  module: ModuleDescriptor,
  overrides: ReadonlyMap<ModuleId, boolean>,
): boolean {
  if (module.status !== "available") {
    return false;
  }

  return overrides.get(module.id) ?? module.enabledByDefault;
}
