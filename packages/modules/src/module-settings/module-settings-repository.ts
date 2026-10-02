import type { ModuleId } from "@lunaecho/core";

export interface ModuleSettingsRepository {
  /** Returns only the modules a guild has explicitly switched; all others use the default. */
  listOverrides(guildId: string): Promise<ReadonlyMap<ModuleId, boolean>>;
  setEnabled(
    guildId: string,
    moduleId: ModuleId,
    enabled: boolean,
    actorId: string,
    updatedAt: Date,
  ): Promise<void>;
}
