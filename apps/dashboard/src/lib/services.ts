import "server-only";

import {
  createRuntimeEntitlementProvider,
  EntitlementService,
  type RuntimeMode,
} from "@lunaecho/core";
import { connectDatabase, type DatabaseConnection } from "@lunaecho/db";
import {
  AutomationService,
  BotTaskQueue,
  CustomBotService,
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
  TokenVault,
  WelcomeCardService,
  WelcomeSettingsService,
} from "@lunaecho/modules";
import pino from "pino";

import { env } from "./env";

export type DashboardServices = Readonly<{
  automation: AutomationService;
  /** Undefined where no token key is configured, so Custom bots cannot be added here. */
  customBots: CustomBotService | undefined;
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
  /** One small pool per Custom bot database, keyed by bot id and connection string. */
  custom?: Map<string, Promise<DashboardServices>>;
}

/** Kept on globalThis so development hot reloads reuse one database pool. */
const holder = globalThis as typeof globalThis & { lunaEchoDashboard?: ServiceHolder };

type ServiceOptions = Readonly<{
  connectionString: string;
  /** Only the Cloud database holds Custom bots; a Custom bot's own database does not. */
  manageCustomBots: boolean;
  poolSize: number;
  runtimeMode: RuntimeMode;
}>;

async function createServices(options: ServiceOptions): Promise<DashboardServices> {
  const database: DatabaseConnection = await connectDatabase({
    connectionString: options.connectionString,
    poolSize: options.poolSize,
    // The bot owns its schema and migrates it on start; the dashboard only reads and writes.
    runMigrations: false,
  });
  const db = database.db;
  const tokenKeyFile = options.manageCustomBots ? env().CUSTOM_BOT_TOKEN_KEY_FILE : undefined;

  // Pages call invalidate() before reading, so they show what the bot stored a moment ago too.
  return {
    automation: new AutomationService(db),
    customBots:
      tokenKeyFile === undefined
        ? undefined
        : new CustomBotService(db, TokenVault.fromKeyFile(tokenKeyFile)),
    entitlements: new EntitlementService(createRuntimeEntitlementProvider(options.runtimeMode)),
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
  holder.lunaEchoDashboard.services ??= createServices({
    connectionString: env().DATABASE_URL,
    manageCustomBots: true,
    poolSize: 5,
    runtimeMode: env().LUNA_RUNTIME_MODE,
  }).catch((error: unknown) => {
    // A failed start must not be cached forever; the next request tries again.
    if (holder.lunaEchoDashboard !== undefined) {
      holder.lunaEchoDashboard.services = undefined;
    }

    throw error;
  });
  return holder.lunaEchoDashboard.services;
}

/**
 * The same services on a Custom bot's own database, logged in as that bot's database role, so
 * the dashboard can reach no other customer's data through it. A changed password (a recreated
 * database) gives a new key and so a new pool.
 */
export function customBotServices(
  botId: string,
  connectionString: string,
): Promise<DashboardServices> {
  holder.lunaEchoDashboard ??= {};
  const pools = (holder.lunaEchoDashboard.custom ??= new Map());
  const key = `${botId}
${connectionString}`;
  let pending = pools.get(key);

  if (pending === undefined) {
    // Drop an older pool of the same bot; its password no longer works.
    for (const stale of [...pools.keys()].filter((candidate) =>
      candidate.startsWith(`${botId}
`),
    )) {
      pools.delete(stale);
    }

    pending = createServices({
      connectionString,
      manageCustomBots: false,
      poolSize: 2,
      runtimeMode: "cloud-custom",
    }).catch((error: unknown) => {
      pools.delete(key);
      throw error;
    });
    pools.set(key, pending);
  }

  return pending;
}
