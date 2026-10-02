import "server-only";

import { EntitlementService, SelfHostedEntitlementProvider } from "@lunaecho/core";
import { connectDatabase, type DatabaseConnection } from "@lunaecho/db";
import {
  AutomationService,
  BotTaskQueue,
  DrizzleModerationCaseRepository,
  DrizzleModerationSettingsRepository,
  DrizzleModuleSettingsRepository,
  DrizzleMusicSettingsRepository,
  DrizzleVoiceRoomRepository,
  ModerationActionService,
  LevelService,
  LogSettingsService,
  ModerationSettingsService,
  ModuleSettingsService,
  MusicSettingsService,
  RoleMenuService,
  SocialFeedService,
  TicketService,
  WelcomeCardService,
  WelcomeSettingsService,
} from "@lunaecho/modules";
import pino from "pino";

import { env } from "./env";

export type DashboardServices = Readonly<{
  automation: AutomationService;
  entitlements: EntitlementService;
  levels: LevelService;
  logs: LogSettingsService;
  moderationCases: ModerationActionService;
  moderationSettings: ModerationSettingsService;
  moduleSettings: ModuleSettingsService;
  musicSettings: MusicSettingsService;
  roleMenus: RoleMenuService;
  social: SocialFeedService;
  tickets: TicketService;
  welcome: WelcomeSettingsService;
  welcomeCards: WelcomeCardService;
  /** Tells the bot about changes so it reloads settings at once. */
  tasks: BotTaskQueue;
  voiceRooms: DrizzleVoiceRoomRepository;
}>;

interface ServiceHolder {
  services?: Promise<DashboardServices> | undefined;
}

/** Kept on globalThis so development hot reloads reuse one database pool. */
const holder = globalThis as typeof globalThis & { lunaEchoDashboard?: ServiceHolder };

async function createServices(): Promise<DashboardServices> {
  const database: DatabaseConnection = await connectDatabase({
    connectionString: env().DATABASE_URL,
    poolSize: 5,
    runMigrations: false,
  });
  const db = database.db;

  // Pages call invalidate() before reading, so they show what the bot stored a moment ago too.
  return {
    automation: new AutomationService(db),
    entitlements: new EntitlementService(new SelfHostedEntitlementProvider()),
    levels: new LevelService(db),
    logs: new LogSettingsService(db),
    moderationCases: new ModerationActionService(
      new DrizzleModerationCaseRepository(db),
      pino({ level: "silent" }),
    ),
    // Short caches: an administrator expects to see a change immediately after saving it.
    moderationSettings: new ModerationSettingsService(
      new DrizzleModerationSettingsRepository(db),
      undefined,
      1_000,
    ),
    moduleSettings: new ModuleSettingsService(new DrizzleModuleSettingsRepository(db), {
      cacheTtlMilliseconds: 1_000,
    }),
    musicSettings: new MusicSettingsService(new DrizzleMusicSettingsRepository(db)),
    roleMenus: new RoleMenuService(db),
    social: new SocialFeedService(db),
    tasks: new BotTaskQueue(db),
    tickets: new TicketService(db),
    voiceRooms: new DrizzleVoiceRoomRepository(db),
    welcome: new WelcomeSettingsService(db),
    welcomeCards: new WelcomeCardService(db),
  };
}

export function services(): Promise<DashboardServices> {
  holder.lunaEchoDashboard ??= {};
  holder.lunaEchoDashboard.services ??= createServices().catch((error: unknown) => {
    // A failed start must not be cached forever; the next request tries again.
    if (holder.lunaEchoDashboard !== undefined) {
      holder.lunaEchoDashboard.services = undefined;
    }

    throw error;
  });
  return holder.lunaEchoDashboard.services;
}
