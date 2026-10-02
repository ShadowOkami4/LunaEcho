import {
  EntitlementService,
  SelfHostedEntitlementProvider,
  type AppLogger,
  type ModuleId,
} from "@lunaecho/core";
import { connectDatabase } from "@lunaecho/db";
import {
  BotTaskQueue,
  DrizzleModuleSettingsRepository,
  ModuleSettingsService,
} from "@lunaecho/modules";

import type { AppConfig } from "../config/environment.js";
import type {
  BotModule,
  ModuleContext,
  TaskHandler,
} from "../infrastructure/discord/bot-module.js";
import { ComponentInteractionRegistry } from "../infrastructure/discord/commands/component-interaction-registry.js";
import { CommandRegistry } from "../infrastructure/discord/commands/command-registry.js";
import { InteractionDispatcher } from "../infrastructure/discord/commands/interaction-dispatcher.js";
import { createDiscordClient, DiscordGateway } from "../infrastructure/discord/discord-gateway.js";
import {
  logGatewayIntents,
  resolveGatewayIntents,
} from "../infrastructure/discord/gateway-intents.js";
import { BotTaskRunner } from "../infrastructure/tasks/bot-task-runner.js";
import { createAutomationModule } from "../modules/automation/automation-module.js";
import { createLevelsModule } from "../modules/levels/levels-module.js";
import { createLogsModule } from "../modules/logs/logs-module.js";
import { createModerationModule } from "../modules/moderation/moderation-module.js";
import { createMusicModule } from "../modules/music/music-module.js";
import { createRolesModule } from "../modules/roles/roles-module.js";
import { createSocialModule } from "../modules/social/social-module.js";
import { createSystemModule } from "../modules/system/system-module.js";
import { createTicketsModule } from "../modules/tickets/tickets-module.js";
import { createUtilitiesModule } from "../modules/utilities/utilities-module.js";
import { createVoiceRoomsModule } from "../modules/voice-rooms/voice-rooms-module.js";
import { createWelcomeModule } from "../modules/welcome/welcome-module.js";
import { LunaApplication } from "./luna-application.js";

/** Builds every module and wires their parts into one running bot. */
export async function createApplication(
  config: AppConfig,
  logger: AppLogger,
): Promise<LunaApplication> {
  const databaseLogger = logger.child({ component: "database" });
  const entitlements = new EntitlementService(new SelfHostedEntitlementProvider());
  const database = await connectDatabase({
    connectionString: config.databaseUrl,
    onPoolError: (error) => {
      databaseLogger.error({ err: error }, "Idle PostgreSQL connection failed");
    },
  });
  databaseLogger.info("PostgreSQL database ready");

  const gatewayIntents = await resolveGatewayIntents(config.discord.token);
  logGatewayIntents(gatewayIntents, logger.child({ component: "discord.gateway" }));
  const client = createDiscordClient(gatewayIntents.intents);
  const moduleSettings = new ModuleSettingsService(
    new DrizzleModuleSettingsRepository(database.db),
  );
  const context: ModuleContext = {
    client,
    logger,
    moduleRuns: async (guildId: string, moduleId: ModuleId) =>
      (await entitlements.canUse(guildId, moduleId)) &&
      (await moduleSettings.isEnabled(guildId, moduleId)),
  };

  const moderation = createModerationModule(context, database.db, entitlements);
  const voiceRooms = createVoiceRoomsModule(context, database.db, config.loadTestBotIds);
  const music = createMusicModule(context, database.db, config);
  // Order matters for messages: moderation first, so later modules skip removed messages.
  const modules: readonly BotModule[] = [
    createSystemModule(moduleSettings),
    moderation.module,
    voiceRooms.module,
    music.module,
    createUtilitiesModule(context, database.db),
    createLevelsModule(context, database.db),
    createWelcomeModule(context, database.db),
    createRolesModule(context, database.db),
    createTicketsModule(context, database.db),
    createAutomationModule(context, database.db),
    createSocialModule(context, database.db, config),
    createLogsModule(context, database.db, moderation.actions, (channelId) =>
      voiceRooms.voiceRooms.isManagedRoom(channelId),
    ),
  ];

  const taskQueue = new BotTaskQueue(database.db);
  const tasks: Record<string, TaskHandler> = {
    "settings-changed": (task) => {
      for (const module of modules) {
        module.invalidate?.(task.guildId);
      }

      return Promise.resolve();
    },
  };

  for (const module of modules) {
    Object.assign(tasks, module.tasks);
  }

  const taskRunner = new BotTaskRunner(
    taskQueue,
    new Map(Object.entries(tasks)),
    logger.child({ component: "tasks" }),
  );
  const gateway = new DiscordGateway({
    client,
    interactionDispatcher: new InteractionDispatcher(
      new CommandRegistry(modules.flatMap((module) => module.commands ?? [])),
      entitlements,
      logger.child({ component: "discord.interactions" }),
      new ComponentInteractionRegistry(modules.flatMap((module) => module.components ?? [])),
      moduleSettings,
    ),
    listeners: modules.flatMap((module) => module.listeners ?? []),
    logger: logger.child({ component: "discord.gateway" }),
    messageCreateHandlers: modules.flatMap((module) => module.messageHandlers ?? []),
    readyHandlers: [
      ...modules.flatMap((module) => (module.onReady === undefined ? [] : [module.onReady])),
      // Tasks such as posting panels need a ready client, so polling starts here.
      () => {
        taskRunner.start();
        return Promise.resolve();
      },
    ],
    token: config.discord.token,
  });

  return new LunaApplication(
    gateway,
    logger,
    {
      entitlements,
      moderationActions: moderation.actions,
      moderationSettings: moderation.settings,
      moduleSettings,
    },
    [taskRunner, ...modules.flatMap((module) => module.resources ?? []), database],
  );
}
