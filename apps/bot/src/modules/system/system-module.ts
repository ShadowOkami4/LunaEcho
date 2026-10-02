import type { ModuleSettingsService } from "@lunaecho/modules";

import type { BotModule } from "../../infrastructure/discord/bot-module.js";
import { infoCommand } from "./info-command.js";

/** Always on: commands that belong to LunaEcho itself rather than a module. */
export function createSystemModule(moduleSettings: ModuleSettingsService): BotModule {
  return {
    commands: [infoCommand],
    invalidate: (guildId) => {
      moduleSettings.invalidate(guildId);
    },
    name: "system",
  };
}
