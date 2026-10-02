import type { RESTPostAPIChatInputApplicationCommandsJSONBody } from "discord.js";

import { rankCommandData } from "./levels/levels.js";
import { moderationActionCommandData } from "./moderation/presentation/moderation-action-command.js";
import { musicCommandData } from "./music/music-command.js";
import { infoCommandData } from "./system/info-command.js";
import { remindCommandData } from "./utilities/reminders.js";
import { roomCommandData } from "./voice-rooms/room-command.js";

/**
 * The slash commands LunaEcho registers with Discord, available without starting the bot.
 * Discord keeps only commands people use day to day; every setting lives in the dashboard, and
 * the remaining commands open small panels instead of long subcommand lists.
 */
export function createCommandDefinitions(): readonly RESTPostAPIChatInputApplicationCommandsJSONBody[] {
  return [
    infoCommandData,
    moderationActionCommandData,
    musicCommandData,
    rankCommandData,
    remindCommandData,
    roomCommandData,
  ];
}
