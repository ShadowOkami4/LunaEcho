/**
 * Measures what LunaEcho spends CPU time, memory, and database storage on, so limits are derived
 * from numbers instead of guesses. Run with `npm run bench`; results are recorded in
 * docs/resource-measurements.md and should be refreshed whenever a module is added.
 */
import { performance } from "node:perf_hooks";

import {
  guildAutomodExemptions,
  guildAutomodRules,
  guildBannedWords,
  guildModerationCases,
  guildModerationSettings,
  guildModules,
  type LunaDatabase,
} from "@lunaecho/db";
import { createTestDatabase } from "@lunaecho/db/testing";
import {
  ChannelType,
  Client,
  GatewayIntentBits,
  type ClientOptions,
  type ClientUser,
  type Message,
} from "discord.js";
import { sql } from "drizzle-orm";

import { createDiscordCacheOptions } from "../src/infrastructure/discord/discord-cache-options.js";
import { AutomodDetector } from "../src/modules/moderation/domain/automod-detector.js";
import { createDefaultAutomodRules, type AutomodRuleSettings } from "@lunaecho/modules";
import { BannedWordMatcher } from "../src/modules/moderation/domain/banned-word-matcher.js";
import type { BannedWord, GuildModerationSettings } from "@lunaecho/modules";
import { LocalHeuristicSafetyClassifier } from "../src/modules/moderation/infrastructure/local-heuristic-safety-classifier.js";

const timestamp = new Date("2026-01-01T00:00:00.000Z");
const typicalMessage = "hey, does anyone know when the next community event starts tonight?";
const longestMessage = "lorem ipsum dolor sit amet consectetur ".repeat(103).slice(0, 4_000);

function snowflake(index: number): string {
  return String(100_000_000_000_000_000n + BigInt(index));
}

function word(index: number): string {
  return `blocked${index.toString(36)}`;
}

function createBannedWords(count: number): BannedWord[] {
  return Array.from({ length: count }, (_, index) => ({
    createdAt: timestamp,
    createdBy: snowflake(1),
    displayValue: word(index),
    normalizedValue: word(index),
  }));
}

function collectGarbage(): void {
  if (typeof globalThis.gc !== "function") {
    throw new Error("Run the benchmark with --expose-gc");
  }

  globalThis.gc();
  globalThis.gc();
}

function heapUsed(): number {
  collectGarbage();
  return process.memoryUsage().heapUsed;
}

/** Returns the retained heap bytes per item; `keep` holds the items alive while measuring. */
function bytesPerItem(count: number, create: (index: number) => unknown): number {
  const keep: unknown[] = [];
  const before = heapUsed();

  for (let index = 0; index < count; index += 1) {
    keep.push(create(index));
  }

  const after = heapUsed();
  keep.length = 0;
  return (after - before) / count;
}

function microsecondsPerCall(iterations: number, run: (index: number) => unknown): number {
  for (let index = 0; index < Math.min(iterations, 2_000); index += 1) {
    run(index);
  }

  const started = performance.now();

  for (let index = 0; index < iterations; index += 1) {
    run(index);
  }

  return ((performance.now() - started) / iterations) * 1_000;
}

async function microsecondsPerAsyncCall(
  iterations: number,
  run: (index: number) => Promise<unknown>,
): Promise<number> {
  for (let index = 0; index < Math.min(iterations, 2_000); index += 1) {
    await run(index);
  }

  const started = performance.now();

  for (let index = 0; index < iterations; index += 1) {
    await run(index);
  }

  return ((performance.now() - started) / iterations) * 1_000;
}

function row(label: string, value: string): void {
  console.log(`${label.padEnd(58)} ${value}`);
}

function formatMicroseconds(value: number): string {
  return `${value.toFixed(1).padStart(9)} µs  (${Math.round(1_000_000 / value).toLocaleString("en-US")} per core-second)`;
}

function formatBytes(value: number): string {
  return `${Math.round(value).toLocaleString("en-US").padStart(9)} bytes`;
}

function measureBannedWordFilter(): void {
  console.log("\n## CPU: banned-word filter, per message without a match (worst case)");

  for (const wordCount of [10, 100, 500, 1_000]) {
    const matcher = new BannedWordMatcher();
    const words = createBannedWords(wordCount);

    row(
      `${wordCount} words, typical message (${typicalMessage.length} chars)`,
      formatMicroseconds(
        microsecondsPerCall(20_000, () => matcher.findMatch(typicalMessage, words)),
      ),
    );
    row(
      `${wordCount} words, longest message (${longestMessage.length} chars)`,
      formatMicroseconds(microsecondsPerCall(300, () => matcher.findMatch(longestMessage, words))),
    );
  }
}

function createAutomodMessage(index: number, content: string): Message<true> {
  return {
    attachments: { size: 0 },
    author: { id: snowflake(index % 50_000) },
    channelId: snowflake(index % 40),
    content,
    guildId: snowflake(index % 500),
    mentions: { everyone: false, roles: { size: 0 }, users: { size: 0 } },
    poll: null,
  } as unknown as Message<true>;
}

async function measureAutomod(): Promise<void> {
  console.log("\n## CPU: AutoMod with all ten rules enabled, per message without a detection");

  // Thresholds far above the test traffic keep every rule evaluating without ever triggering.
  const rules: AutomodRuleSettings[] = createDefaultAutomodRules().map((rule) => ({
    ...rule,
    enabled: true,
    threshold: { ...rule.threshold, triggerLimit: 1_000_000 },
  }));
  const detector = new AutomodDetector(new LocalHeuristicSafetyClassifier());

  row(
    "typical message",
    formatMicroseconds(
      await microsecondsPerAsyncCall(50_000, (index) =>
        detector.detect(createAutomodMessage(index, typicalMessage), rules),
      ),
    ),
  );
  row(
    "longest message",
    formatMicroseconds(
      await microsecondsPerAsyncCall(2_000, (index) =>
        detector.detect(createAutomodMessage(index, longestMessage), rules),
      ),
    ),
  );
}

function createCachedSettings(guildIndex: number, wordCount: number): GuildModerationSettings {
  return {
    automodProfile: "balanced",
    automodRules: createDefaultAutomodRules(),
    bannedWords: Array.from({ length: wordCount }, (_, index) => ({
      createdAt: new Date(timestamp),
      createdBy: snowflake(guildIndex),
      // Built at runtime so every guild holds its own strings, as rows read from the database do.
      displayValue: `${word(index)}${guildIndex}`.slice(0, 12),
      normalizedValue: `${word(index)}${guildIndex}`.slice(0, 12),
    })),
    bannedWordsEnabled: true,
    dmNotificationsEnabled: true,
    exemptChannelIds: Array.from({ length: 5 }, (_, index) => snowflake(guildIndex + index)),
    exemptRoleIds: Array.from({ length: 5 }, (_, index) => snowflake(guildIndex + index)),
    guildId: snowflake(guildIndex),
    staffExempt: true,
  };
}

function measureProcessMemory(): void {
  console.log("\n## Memory: LunaEcho's own per-guild state");

  for (const wordCount of [0, 100, 1_000]) {
    row(
      `cached moderation settings, ${wordCount} banned words`,
      `${formatBytes(bytesPerItem(1_000, (index) => createCachedSettings(index, wordCount)))} per guild`,
    );
  }

  row(
    "cached module switches",
    `${formatBytes(bytesPerItem(5_000, (index) => ({ expiresAt: index, overrides: new Map([["moderation", false]]) })))} per guild`,
  );
  row(
    "AutoMod activity window, 10 recent messages",
    `${formatBytes(
      bytesPerItem(5_000, (index) => ({
        activity: Array.from({ length: 10 }, (_, entry) => ({
          channelId: snowflake(index + entry),
          timestamp: index + entry,
        })),
        key: `${snowflake(index)}:${snowflake(index + 1)}`,
      })),
    )} per active member`,
  );
}

/** Feeds raw gateway payloads into discord.js to measure what its caches retain. */
function measureDiscordCaches(): void {
  console.log("\n## Memory: discord.js caches (default settings keep 200 messages per channel)");

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });
  const guildId = snowflake(1);
  const channelCount = 50;
  const roleCount = 30;
  const guildPayload = (index: number) => ({
    channels: Array.from({ length: channelCount }, (_, channel) => ({
      guild_id: snowflake(index),
      id: snowflake(index * 1_000 + channel),
      name: `channel-${channel}`,
      permission_overwrites: [],
      position: channel,
      type: ChannelType.GuildText,
    })),
    id: snowflake(index),
    members: [],
    name: `Guild ${index}`,
    owner_id: snowflake(2),
    roles: Array.from({ length: roleCount }, (_, role) => ({
      color: 0,
      hoist: false,
      id: role === 0 ? snowflake(index) : snowflake(index * 1_000 + 500 + role),
      managed: false,
      mentionable: false,
      name: role === 0 ? "@everyone" : `role-${role}`,
      permissions: "1024",
      position: role,
    })),
    unavailable: false,
  });
  const guilds = client.guilds as unknown as { _add(data: unknown): unknown };

  row(
    `guild with ${channelCount} channels and ${roleCount} roles`,
    formatBytes(bytesPerItem(200, (index) => guilds._add(guildPayload(index + 10)))),
  );

  guilds._add(guildPayload(1));
  const guild = client.guilds.cache.get(guildId);

  if (guild === undefined) {
    throw new Error("The benchmark guild was not cached");
  }

  // Messages are spread over all channels so none reaches the 200-message cache limit.
  const messagesPerChannel = 100;
  const addMessage = (channelIndex: number, payload: unknown): unknown => {
    const channel = client.channels.cache.get(snowflake(1_000 + channelIndex));

    if (!channel?.isTextBased()) {
      throw new Error("The benchmark guild has no text channel");
    }

    // A JSON round trip gives every message its own strings, as gateway payloads do.
    const parsed: unknown = JSON.parse(JSON.stringify(payload));
    return (channel.messages as unknown as { _add(data: unknown): unknown })._add(parsed);
  };
  const messagePayload = (index: number, authorIndex: number, content: string) => ({
    attachments: [],
    author: {
      avatar: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
      discriminator: "0",
      global_name: `Member ${authorIndex}`,
      id: snowflake(5_000_000 + authorIndex),
      username: `member${authorIndex}`,
    },
    channel_id: snowflake(1_000 + (index % channelCount)),
    content: `${content} ${index}`,
    edited_timestamp: null,
    embeds: [],
    flags: 0,
    guild_id: guildId,
    id: snowflake(9_000_000 + index),
    member: {
      deaf: false,
      flags: 0,
      joined_at: timestamp.toISOString(),
      mute: false,
      roles: [snowflake(1_501), snowflake(1_502)],
    },
    mention_everyone: false,
    mention_roles: [],
    mentions: [],
    pinned: false,
    timestamp: timestamp.toISOString(),
    tts: false,
    type: 0,
  });

  const messageCount = channelCount * messagesPerChannel;
  const cachedMessages = (): number =>
    guild.channels.cache.reduce(
      (total, channel) => total + (channel.isTextBased() ? channel.messages.cache.size : 0),
      0,
    );

  // One author for every message isolates the message itself from its cached author.
  addMessage(0, messagePayload(0, 0, typicalMessage));
  const messagesBefore = cachedMessages();
  const typicalMessageBytes = bytesPerItem(messageCount / 2, (index) =>
    addMessage(index % channelCount, messagePayload(1 + index, 0, typicalMessage)),
  );
  const longestMessageBytes = bytesPerItem(messageCount / 4, (index) =>
    addMessage(index % channelCount, messagePayload(100_000 + index, 0, longestMessage)),
  );

  if (cachedMessages() - messagesBefore !== messageCount / 2 + messageCount / 4) {
    throw new Error("discord.js evicted benchmark messages; the per-message figures are invalid");
  }

  row("cached message, typical content", `${formatBytes(typicalMessageBytes)} per message`);
  row("cached message, longest content", `${formatBytes(longestMessageBytes)} per message`);

  // Every message author is also cached as a user and as a guild member, without any limit.
  const membersBefore = guild.members.cache.size;
  const authorCount = 5_000;
  const authorBytes = bytesPerItem(authorCount, (index) =>
    addMessage(0, messagePayload(200_000 + index, 1 + index, typicalMessage)),
  );

  if (guild.members.cache.size - membersBefore !== authorCount) {
    throw new Error("discord.js did not cache every benchmark author");
  }

  row("cached user + guild member", `${formatBytes(authorBytes)} per message author`);
  row(
    `full message cache, ${channelCount} channels x 200 messages`,
    `${formatBytes(channelCount * 200 * typicalMessageBytes)} per guild`,
  );

  void client.destroy();
}

/** Retained heap of one busy guild: 10,000 messages from 5,000 authors over 50 channels. */
function measureBusyGuild(options: Omit<ClientOptions, "intents">): number {
  const client = new Client({ ...options, intents: [GatewayIntentBits.Guilds] });
  client.user = { id: snowflake(2) } as ClientUser;
  const guildId = snowflake(1);
  const channelIds = Array.from({ length: 50 }, (_, index) => snowflake(1_000 + index));
  const before = heapUsed();

  (client.guilds as unknown as { _add(data: unknown): unknown })._add({
    channels: channelIds.map((id, position) => ({
      guild_id: guildId,
      id,
      name: `channel-${position}`,
      permission_overwrites: [],
      position,
      type: ChannelType.GuildText,
    })),
    id: guildId,
    members: [],
    name: "Busy guild",
    owner_id: snowflake(2),
    roles: [{ id: guildId, name: "@everyone", permissions: "0", position: 0 }],
    unavailable: false,
  });

  for (let index = 0; index < 10_000; index += 1) {
    const channel = client.channels.cache.get(channelIds[index % channelIds.length] ?? "");

    if (channel?.type !== ChannelType.GuildText) {
      throw new Error("The busy guild has no text channel");
    }

    const authorIndex = index % 5_000;
    // A JSON round trip gives every message its own strings, as gateway payloads do.
    const payload: unknown = JSON.parse(
      JSON.stringify({
        attachments: [],
        author: {
          avatar: null,
          discriminator: "0",
          id: snowflake(5_000_000 + authorIndex),
          username: `member${authorIndex}`,
        },
        channel_id: channel.id,
        content: `${typicalMessage} ${index}`,
        embeds: [],
        guild_id: guildId,
        id: snowflake(9_000_000 + index),
        member: { joined_at: timestamp.toISOString(), roles: [] },
        mentions: [],
        timestamp: timestamp.toISOString(),
        type: 0,
      }),
    );
    (channel.messages as unknown as { _add(data: unknown): unknown })._add(payload);
  }

  // Runs the user sweep the configured sweeper would run once per hour.
  const sweepUsers = options.sweepers?.users?.filter;

  if (sweepUsers !== undefined) {
    const shouldSweep = sweepUsers();

    if (shouldSweep !== null) {
      client.users.cache.sweep((user) => shouldSweep(user, user.id, client.users.cache));
    }
  }

  const retained = heapUsed() - before;
  void client.destroy();
  return retained;
}

function measureDiscordCacheLimits(): void {
  console.log("\n## Memory: one busy guild, 10,000 messages from 5,000 authors in 50 channels");

  const withDefaults = measureBusyGuild({});
  const withLimits = measureBusyGuild(createDiscordCacheOptions());

  row("discord.js default caches", formatBytes(withDefaults));
  row("LunaEcho cache limits", formatBytes(withLimits));
  row("saved", `${((1 - withLimits / withDefaults) * 100).toFixed(1).padStart(9)} %`);
}

async function tableBytes(db: LunaDatabase, table: string): Promise<number> {
  const result = (await db.execute(
    sql`SELECT pg_total_relation_size(${table}::regclass) AS bytes`,
  )) as { rows: { bytes: number | string }[] };

  return Number(result.rows[0]?.bytes ?? 0);
}

async function measureStorage(): Promise<void> {
  console.log("\n## Database: bytes per row including indexes (PostgreSQL on-disk format)");

  const connection = await createTestDatabase();
  const db = connection.db;
  const guildCount = 200;
  const guildIds = Array.from({ length: guildCount }, (_, index) => snowflake(index));

  await db
    .insert(guildModerationSettings)
    .values(guildIds.map((guildId) => ({ createdAt: timestamp, guildId, updatedAt: timestamp })));
  await db.insert(guildModules).values(
    guildIds.map((guildId) => ({
      enabled: false,
      guildId,
      moduleId: "moderation",
      updatedAt: timestamp,
      updatedBy: snowflake(1),
    })),
  );

  for (const guildId of guildIds) {
    await db.insert(guildBannedWords).values(
      createBannedWords(100).map((bannedWord) => ({
        createdAt: timestamp,
        createdBy: snowflake(1),
        displayWord: bannedWord.displayValue,
        guildId,
        normalizedWord: bannedWord.normalizedValue,
      })),
    );
    await db.insert(guildAutomodRules).values(
      createDefaultAutomodRules().map((rule) => ({
        action: rule.action,
        createdAt: timestamp,
        enabled: rule.enabled,
        guildId,
        ruleKind: rule.kind,
        secondaryLimit: rule.threshold.secondaryLimit,
        timeoutSeconds: rule.timeoutSeconds,
        triggerLimit: rule.threshold.triggerLimit,
        updatedAt: timestamp,
        updatedBy: snowflake(1),
        windowSeconds: rule.threshold.windowSeconds,
      })),
    );
    await db.insert(guildAutomodExemptions).values(
      Array.from({ length: 50 }, (_, index) => ({
        createdAt: timestamp,
        createdBy: snowflake(1),
        guildId,
        targetId: snowflake(index),
        targetKind: index < 25 ? "channel" : "role",
      })),
    );
  }

  const casesPerGuild = 500;
  const insertCases = async (reason: string, firstCaseNumber: number): Promise<void> => {
    for (const guildId of guildIds) {
      await db.insert(guildModerationCases).values(
        Array.from({ length: casesPerGuild }, (_, index) => ({
          action: "automod",
          caseNumber: firstCaseNumber + index,
          completedAt: timestamp,
          createdAt: timestamp,
          guildId,
          moderatorUserId: snowflake(1),
          reason,
          status: "completed",
          targetUserId: snowflake(index % 100),
        })),
      );
    }
  };
  const caseRows = guildCount * casesPerGuild;

  await insertCases("AutoMod: mention-spam", 1);
  const automodCaseBytes = (await tableBytes(db, "guild_moderation_cases")) / caseRows;
  await insertCases("x".repeat(400), casesPerGuild + 1);
  const longCaseBytes =
    ((await tableBytes(db, "guild_moderation_cases")) - automodCaseBytes * caseRows) / caseRows;

  row("moderation case, AutoMod reason (21 chars)", `${formatBytes(automodCaseBytes)} per case`);
  row("moderation case, longest reason (400 chars)", `${formatBytes(longCaseBytes)} per case`);
  row(
    "banned word",
    `${formatBytes((await tableBytes(db, "guild_banned_words")) / (guildCount * 100))} per word`,
  );
  row(
    "AutoMod rules, all ten stored",
    `${formatBytes((await tableBytes(db, "guild_automod_rules")) / guildCount)} per guild`,
  );
  row(
    "AutoMod exemptions, 25 channels + 25 roles",
    `${formatBytes((await tableBytes(db, "guild_automod_exemptions")) / guildCount)} per guild`,
  );
  row(
    "moderation settings + one module switch",
    `${formatBytes(
      ((await tableBytes(db, "guild_moderation_settings")) +
        (await tableBytes(db, "guild_modules"))) /
        guildCount,
    )} per guild`,
  );

  await connection.close();
}

console.log(`LunaEcho resource benchmark · Node.js ${process.version} · ${process.arch}`);
measureBannedWordFilter();
await measureAutomod();
measureProcessMemory();
measureDiscordCaches();
measureDiscordCacheLimits();
await measureStorage();
