import { isModuleId, type ModuleId } from "@lunaecho/core";
import { guildModules, type LunaDatabase } from "@lunaecho/db";
import { eq } from "drizzle-orm";

import type { ModuleSettingsRepository } from "./module-settings-repository.js";

export class DrizzleModuleSettingsRepository implements ModuleSettingsRepository {
  public constructor(private readonly database: LunaDatabase) {}

  public async listOverrides(guildId: string): Promise<ReadonlyMap<ModuleId, boolean>> {
    const rows = await this.database
      .select({ enabled: guildModules.enabled, moduleId: guildModules.moduleId })
      .from(guildModules)
      .where(eq(guildModules.guildId, guildId));
    const overrides = new Map<ModuleId, boolean>();

    for (const row of rows) {
      // Rows for modules removed from the catalog are kept in storage but ignored.
      if (isModuleId(row.moduleId)) {
        overrides.set(row.moduleId, row.enabled);
      }
    }

    return overrides;
  }

  public async setEnabled(
    guildId: string,
    moduleId: ModuleId,
    enabled: boolean,
    actorId: string,
    updatedAt: Date,
  ): Promise<void> {
    const values = { enabled, updatedAt, updatedBy: actorId };

    await this.database
      .insert(guildModules)
      .values({ ...values, guildId, moduleId })
      .onConflictDoUpdate({ set: values, target: [guildModules.guildId, guildModules.moduleId] });
  }
}
