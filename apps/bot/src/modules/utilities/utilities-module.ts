import type { LunaDatabase } from "@lunaecho/db";
import { ReminderService } from "@lunaecho/modules";

import type { BotModule, ModuleContext } from "../../infrastructure/discord/bot-module.js";
import { createRemindCommand, ReminderDelivery, ReminderPanelHandler } from "./reminders.js";

export function createUtilitiesModule(context: ModuleContext, database: LunaDatabase): BotModule {
  const reminders = new ReminderService(database);
  const delivery = new ReminderDelivery(
    reminders,
    context.client,
    context.logger.child({ component: "utilities.reminders" }),
  );

  return {
    commands: [createRemindCommand(reminders)],
    components: [new ReminderPanelHandler(reminders)],
    name: "utilities",
    onReady: () => {
      delivery.start();
      return Promise.resolve();
    },
    resources: [delivery],
  };
}
