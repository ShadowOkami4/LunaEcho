/**
 * Live check of the dashboard-driven modules on the test server. It drives the running bot exactly
 * like the dashboard does (settings in PostgreSQL plus tasks in the queue) and reads the results
 * back from Discord. Start the bot first (`npm run dev`), then:
 *
 *   npm run live:modules
 *
 * It creates a temporary category with channels and a temporary role, restores every setting it
 * touched, and deletes what it created. Buttons, modals, and member joins need a real person and
 * are not part of this check.
 */
import "../src/config/load-env.js";

import { automationRules, connectDatabase, socialFeeds } from "@lunaecho/db";
import {
  AutomationService,
  DrizzleModuleSettingsRepository,
  BotTaskQueue,
  fetchYouTubeVideos,
  LogSettingsService,
  ModuleSettingsService,
  resolveYouTubeChannel,
  RoleMenuService,
  TicketService,
  WelcomeSettingsService,
  type BotTaskKind,
  type BotTaskPayloads,
} from "@lunaecho/modules";
import {
  REST,
  ChannelType,
  PermissionFlagsBits,
  Routes,
  type APIChannel,
  type APIGuild,
  type APIGuildMember,
  type APIMessage,
  type APIRole,
} from "discord.js";
import { eq } from "drizzle-orm";

const testGuildId = "1227203223383707708";
const guildId = process.env["DISCORD_DEVELOPMENT_GUILD_ID"];
const token = process.env["DISCORD_TOKEN"];
const applicationId = process.env["DISCORD_APPLICATION_ID"];
const databaseUrl = process.env["DATABASE_URL"];

if (
  guildId !== testGuildId ||
  token === undefined ||
  applicationId === undefined ||
  databaseUrl === undefined
) {
  throw new Error(
    "This probe only runs against the test server; check DISCORD_DEVELOPMENT_GUILD_ID.",
  );
}

const rest = new REST({ version: "10" }).setToken(token);
const database = await connectDatabase({
  connectionString: databaseUrl,
  poolSize: 2,
  runMigrations: false,
});
const db = database.db;
const tasks = new BotTaskQueue(db);
const modules = new ModuleSettingsService(new DrizzleModuleSettingsRepository(db), {
  cacheTtlMilliseconds: 0,
});
const welcome = new WelcomeSettingsService(db);
const tickets = new TicketService(db);
const logs = new LogSettingsService(db);
const roleMenus = new RoleMenuService(db);
const automation = new AutomationService(db);

type Check = Readonly<{ detail: string; name: string; ok: boolean }>;
const results: Check[] = [];

function record(name: string, ok: boolean, detail: string): void {
  results.push({ detail, name, ok });
  console.log(`${ok ? "✅" : "❌"} ${name}: ${detail}`);
}

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitFor<Value>(
  probe: () => Promise<Value | undefined>,
  timeoutMilliseconds: number,
): Promise<Value | undefined> {
  const deadline = Date.now() + timeoutMilliseconds;

  while (Date.now() < deadline) {
    const value = await probe();

    if (value !== undefined) {
      return value;
    }

    await sleep(2_000);
  }

  return undefined;
}

async function messages(channelId: string): Promise<APIMessage[]> {
  return (await rest.get(Routes.channelMessages(channelId), {
    query: new URLSearchParams({ limit: "50" }),
  })) as APIMessage[];
}

/** Components V2 messages keep their text in components, so both are searched. */
function textOf(message: APIMessage): string {
  return `${message.content}\n${JSON.stringify(message.components ?? [])}`;
}

async function findMessage(channelId: string, needle: string, timeout = 20_000) {
  return waitFor(
    async () => (await messages(channelId)).find((message) => textOf(message).includes(needle)),
    timeout,
  );
}

async function queue<Kind extends BotTaskKind>(
  kind: Kind,
  payload: BotTaskPayloads[Kind],
): Promise<void> {
  await tasks.enqueue(kind, testGuildId, payload);
}

// --- Preflight ---------------------------------------------------------------------------------

const guild = (await rest.get(Routes.guild(testGuildId))) as APIGuild;
const roles = (await rest.get(Routes.guildRoles(testGuildId))) as APIRole[];
const me = (await rest.get(Routes.guildMember(testGuildId, applicationId))) as APIGuildMember;
const granted = roles
  .filter((role) => role.id === testGuildId || me.roles.includes(role.id))
  .reduce((all, role) => all | BigInt(role.permissions), 0n);
const has = (flag: bigint) =>
  (granted & PermissionFlagsBits.Administrator) !== 0n || (granted & flag) !== 0n;
const needed = {
  AttachFiles: PermissionFlagsBits.AttachFiles,
  CreatePrivateThreads: PermissionFlagsBits.CreatePrivateThreads,
  ManageChannels: PermissionFlagsBits.ManageChannels,
  ManageRoles: PermissionFlagsBits.ManageRoles,
  ManageThreads: PermissionFlagsBits.ManageThreads,
  SendMessagesInThreads: PermissionFlagsBits.SendMessagesInThreads,
} as const;
const missing = Object.entries(needed)
  .filter(([, flag]) => !has(flag))
  .map(([name]) => name);
record(
  "Bot permissions",
  missing.length === 0,
  missing.length === 0 ? "all present" : `missing ${missing.join(", ")}`,
);

if (!has(PermissionFlagsBits.ManageChannels)) {
  await database.close();
  throw new Error("LunaEcho needs Manage Channels on the test server for this probe.");
}

// --- Setup -------------------------------------------------------------------------------------

const created: string[] = [];
const createChannel = async (name: string, type: ChannelType, parentId?: string) => {
  const channel = (await rest.post(Routes.guildChannels(testGuildId), {
    body: { name, type, ...(parentId === undefined ? {} : { parent_id: parentId }) },
    reason: "LunaEcho live module probe",
  })) as APIChannel;
  created.push(channel.id);
  return channel.id;
};

const category = await createChannel("lunaecho-probe", ChannelType.GuildCategory);
const logChannel = await createChannel("probe-logs", ChannelType.GuildText, category);
const panelChannel = await createChannel("probe-panels", ChannelType.GuildText, category);
const otherChannel = await createChannel("probe-other", ChannelType.GuildText, category);
const socialChannel = await createChannel("probe-social", ChannelType.GuildText, category);
const probeRole = has(PermissionFlagsBits.ManageRoles)
  ? ((await rest.post(Routes.guildRoles(testGuildId), {
      body: { name: "LunaEcho Probe" },
      reason: "LunaEcho live module probe",
    })) as APIRole)
  : undefined;

const moduleIds = [
  "logs",
  "onboarding",
  "roles",
  "tickets",
  "automation",
  "social-notifications",
] as const;
const previousModules = new Map(
  (await modules.getStates(testGuildId)).map((state) => [state.module.id, state.enabled]),
);
const previousWelcome = await welcome.get(testGuildId);
const previousTickets = await tickets.getSettings(testGuildId);
const previousLogs = await logs.get(testGuildId);
let menuId: string | undefined;
let ruleId: string | undefined;
let feedId: string | undefined;

try {
  for (const moduleId of moduleIds) {
    await modules.setEnabled(testGuildId, moduleId, true, "live-probe");
  }

  await queue("settings-changed", { module: "modules" });

  // --- Logs --------------------------------------------------------------------------------------
  await logs.save(
    { ...previousLogs, channels: { ...previousLogs.channels, server: logChannel } },
    "live-probe",
  );
  await queue("settings-changed", { module: "logs" });
  await sleep(5_000);
  const temporary = await createChannel("probe-temp", ChannelType.GuildText, category);
  const createdLog = await findMessage(logChannel, "Channel created");
  record(
    "Logs: channel created",
    createdLog !== undefined,
    createdLog === undefined ? "no entry" : "entry posted",
  );
  await rest.delete(Routes.channel(temporary));
  created.splice(created.indexOf(temporary), 1);
  const deletedLog = await findMessage(logChannel, "Channel deleted");
  record(
    "Logs: channel deleted",
    deletedLog !== undefined,
    deletedLog === undefined ? "no entry" : "entry posted",
  );

  // --- Verification panel ------------------------------------------------------------------------
  if (probeRole !== undefined) {
    await welcome.save(
      { ...previousWelcome, verificationChannelId: panelChannel, verificationRoleId: probeRole.id },
      "live-probe",
    );
    await queue("settings-changed", { module: "onboarding" });
    await queue("post-verification-panel", {});
    const first = await findMessage(panelChannel, "verify:confirm");
    await queue("post-verification-panel", {});
    const replaced = await waitFor(async () => {
      const panels = (await messages(panelChannel)).filter((message) =>
        textOf(message).includes("verify:confirm"),
      );
      return panels.length === 1 && panels[0]?.id !== first?.id ? panels[0] : undefined;
    }, 20_000);
    record(
      "Welcome: verification panel",
      first !== undefined && replaced !== undefined,
      first === undefined
        ? "not posted"
        : replaced === undefined
          ? "posted, but reposting did not replace it"
          : "posted and replaced on repost",
    );
  }

  // --- Ticket panel ------------------------------------------------------------------------------
  await tickets.saveSettings(
    { ...previousTickets, panelChannelId: panelChannel, transcriptChannelId: logChannel },
    "live-probe",
  );
  await queue("settings-changed", { module: "tickets" });
  await queue("post-ticket-panel", {});
  const ticketPanel = await findMessage(panelChannel, "ticket:open");
  record(
    "Tickets: panel",
    ticketPanel !== undefined,
    ticketPanel === undefined ? "not posted" : "posted with Open ticket button",
  );

  // --- Role menu ---------------------------------------------------------------------------------
  if (probeRole !== undefined) {
    const menu = await roleMenus.save(
      {
        channelId: panelChannel,
        description: "Live probe",
        guildId: testGuildId,
        mode: "single",
        options: [{ description: null, emoji: "🧪", label: "Probe", roleId: probeRole.id }],
        style: "buttons",
        title: "Probe roles",
      },
      "live-probe",
    );
    menuId = menu.id;
    await queue("post-role-menu", { menuId });
    const posted = await findMessage(panelChannel, `roles:${menuId}:${probeRole.id}`);
    record(
      "Roles: menu posted",
      posted !== undefined,
      posted === undefined ? "not posted" : "posted with role button",
    );

    // Moving the menu: the dashboard removes the old message and posts in the new channel.
    roleMenus.invalidate(testGuildId);
    const stored = await roleMenus.get(testGuildId, menuId);
    await roleMenus.save(
      { ...menu, channelId: otherChannel, id: menuId, style: "select" },
      "live-probe",
    );

    if (stored?.messageId != null) {
      await queue("remove-role-menu", { channelId: panelChannel, messageId: stored.messageId });
    }

    await queue("post-role-menu", { menuId });
    const moved = await findMessage(otherChannel, `roles:${menuId}`);
    const oldGone = await waitFor(
      async () =>
        (await messages(panelChannel)).some((message) =>
          textOf(message).includes(`roles:${menuId}`),
        )
          ? undefined
          : true,
      20_000,
    );
    record(
      "Roles: menu moved",
      moved !== undefined && oldGone === true,
      moved === undefined
        ? "not posted in the new channel"
        : oldGone === true
          ? "new select menu posted, old message removed"
          : "old message still there",
    );
  }

  // --- Scheduled automation ----------------------------------------------------------------------
  const marker = `Probe ${Date.now()}`;
  const rule = await automation.save(
    {
      actions: [{ channelId: otherChannel, kind: "send-message", text: `${marker} on {server}` }],
      conditions: { channelIds: [], excludedRoleIds: [], requiredRoleIds: [] },
      cooldownSeconds: 0,
      enabled: true,
      guildId: testGuildId,
      name: "Live probe",
      trigger: { intervalMinutes: 60, kind: "schedule" },
    },
    "live-probe",
  );
  ruleId = rule.id;
  await db
    .update(automationRules)
    .set({ nextRunAt: new Date(Date.now() - 1_000) })
    .where(eq(automationRules.id, ruleId));
  const scheduled = await findMessage(otherChannel, `${marker} on ${guild.name}`, 90_000);
  record(
    "Automation: scheduled message",
    scheduled !== undefined,
    scheduled === undefined ? "nothing within 90 s" : "posted with placeholders filled",
  );

  // --- Social: YouTube ---------------------------------------------------------------------------
  const channel = await resolveYouTubeChannel("@YouTube");
  const videos = await fetchYouTubeVideos(channel.channelId);
  const [newest, previous] = videos;

  if (newest !== undefined && previous !== undefined) {
    feedId = crypto.randomUUID();
    // Pretending the second-newest video was the last one seen makes the newest one "new".
    await db.insert(socialFeeds).values({
      channelId: socialChannel,
      displayName: channel.name,
      guildId: testGuildId,
      id: feedId,
      lastItemId: previous.id,
      message: null,
      nextCheckAt: new Date(),
      pingRoleId: null,
      platform: "youtube",
      sourceId: channel.channelId,
      updatedAt: new Date(),
      updatedBy: "live-probe",
    });
    const announced = await findMessage(socialChannel, newest.id, 90_000);
    record(
      "Social: YouTube video",
      announced !== undefined,
      announced === undefined ? "nothing within 90 s" : `announced “${newest.title}”`,
    );
  } else {
    record("Social: YouTube video", false, "the feed had fewer than two videos");
  }
} finally {
  // --- Cleanup -----------------------------------------------------------------------------------
  if (menuId !== undefined) {
    await roleMenus.delete(testGuildId, menuId);
  }

  if (ruleId !== undefined) {
    await automation.delete(testGuildId, ruleId);
  }

  if (feedId !== undefined) {
    await db.delete(socialFeeds).where(eq(socialFeeds.id, feedId));
  }

  await welcome.save(previousWelcome, "live-probe");
  await welcome.setVerificationMessage(testGuildId, previousWelcome.verificationMessageId);
  await tickets.saveSettings(previousTickets, "live-probe");
  await tickets.setPanelMessage(testGuildId, previousTickets.panelMessageId);
  await logs.save(previousLogs, "live-probe");

  for (const moduleId of moduleIds) {
    await modules.setEnabled(
      testGuildId,
      moduleId,
      previousModules.get(moduleId) ?? false,
      "live-probe",
    );
  }

  await queue("settings-changed", { module: "modules" });

  for (const id of [...created].reverse()) {
    await rest.delete(Routes.channel(id)).catch(() => undefined);
  }

  if (probeRole !== undefined) {
    await rest.delete(Routes.guildRole(testGuildId, probeRole.id)).catch(() => undefined);
  }

  await database.close();
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed. Cleanup done.`);
process.exit(failed.length === 0 ? 0 : 1);
