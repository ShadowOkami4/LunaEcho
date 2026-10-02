import type { EntitlementService } from "@lunaecho/core";
import type { LunaDatabase } from "@lunaecho/db";
import {
  DrizzleModerationCaseRepository,
  DrizzleModerationSettingsRepository,
  ModerationActionService,
  ModerationSettingsService,
} from "@lunaecho/modules";

import type { BotModule, ModuleContext } from "../../infrastructure/discord/bot-module.js";
import { ModuleGatedMessageHandler } from "../../infrastructure/discord/module-gated-message-handler.js";
import { AutomodMessageFilter } from "./application/automod-message-filter.js";
import { BannedWordMessageFilter } from "./application/banned-word-message-filter.js";
import { AutomodDetector } from "./domain/automod-detector.js";
import { DiscordModerationUserNotifier } from "./infrastructure/discord-moderation-user-notifier.js";
import { LocalHeuristicSafetyClassifier } from "./infrastructure/local-heuristic-safety-classifier.js";
import { createModerationActionCommand } from "./presentation/moderation-action-command.js";

export function createModerationModule(
  context: ModuleContext,
  database: LunaDatabase,
  entitlements: EntitlementService,
): Readonly<{
  actions: ModerationActionService;
  module: BotModule;
  settings: ModerationSettingsService;
}> {
  const logger = context.logger.child({ component: "moderation" });
  const settings = new ModerationSettingsService(new DrizzleModerationSettingsRepository(database));
  const actions = new ModerationActionService(
    new DrizzleModerationCaseRepository(database),
    logger.child({ component: "moderation.actions" }),
    undefined,
    (guildId) => entitlements.getQuota(guildId, "stored-moderation-cases-per-guild"),
  );
  const notifier = new DiscordModerationUserNotifier(
    logger.child({ component: "moderation.notifications" }),
  );
  const gate = { isEnabled: context.moduleRuns };

  return {
    actions,
    module: {
      commands: [createModerationActionCommand(actions, settings, notifier)],
      invalidate: (guildId) => {
        settings.invalidate(guildId);
      },
      messageHandlers: [
        new ModuleGatedMessageHandler(
          "moderation",
          gate,
          new BannedWordMessageFilter(
            settings,
            logger.child({ component: "moderation.banned-words" }),
          ),
        ),
        new ModuleGatedMessageHandler(
          "moderation",
          gate,
          new AutomodMessageFilter(
            settings,
            actions,
            new AutomodDetector(new LocalHeuristicSafetyClassifier()),
            notifier,
            logger.child({ component: "moderation.automod" }),
          ),
        ),
      ],
      name: "moderation",
    },
    settings,
  };
}
