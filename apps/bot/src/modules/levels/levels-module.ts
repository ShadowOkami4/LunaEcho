import type { LunaDatabase } from "@lunaecho/db";
import { LevelService } from "@lunaecho/modules";

import type { BotModule, ModuleContext } from "../../infrastructure/discord/bot-module.js";
import {
  applyLevelUp,
  createRankCommand,
  LeaderboardPanelHandler,
  VoiceXpTicker,
} from "./levels.js";

export function createLevelsModule(context: ModuleContext, database: LunaDatabase): BotModule {
  const logger = context.logger.child({ component: "levels" });
  const levels = new LevelService(database);
  const ticker = new VoiceXpTicker(
    levels,
    context.client,
    (guildId) => context.moduleRuns(guildId, "levels"),
    logger,
  );

  return {
    commands: [createRankCommand(levels)],
    components: [new LeaderboardPanelHandler(levels)],
    invalidate: (guildId) => {
      levels.invalidate(guildId);
    },
    messageHandlers: [
      {
        handle: async (message) => {
          if (
            !message.inGuild() ||
            message.author.bot ||
            message.webhookId !== null ||
            !(await context.moduleRuns(message.guildId, "levels"))
          ) {
            return "continue";
          }

          const levelUp = await levels.awardMessageXp({
            channelId: message.channelId,
            guildId: message.guildId,
            roleIds: message.member === null ? [] : [...message.member.roles.cache.keys()],
            userId: message.author.id,
          });

          if (levelUp !== undefined) {
            await applyLevelUp(levels, message.guild, levelUp, message.channelId, logger);
          }

          return "continue";
        },
      },
    ],
    name: "levels",
    onReady: () => {
      ticker.start();
      return Promise.resolve();
    },
    resources: [ticker],
  };
}
