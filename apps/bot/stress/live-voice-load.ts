/**
 * Live Voice Rooms load test on a real Discord test server.
 *
 * Helper bots (their own applications and tokens, never the LunaEcho token) repeatedly join the
 * lobby and measure how long LunaEcho takes to move them into a new room, then leave again.
 * The running LunaEcho bot must list the helpers in LOAD_TEST_BOT_IDS.
 *
 *   LOAD_BOT_TOKENS=token1,token2 LIVE_LOBBY_CHANNEL_ID=... npm run live:voice -- --rounds 20
 *
 * It only ever acts in DISCORD_DEVELOPMENT_GUILD_ID.
 */
import "../src/config/load-env.js";

import { parseArgs } from "node:util";

import {
  Client,
  Events,
  GatewayDispatchEvents,
  GatewayIntentBits,
  GatewayOpcodes,
} from "discord.js";

import { LatencyRecorder, sleep } from "./metrics.js";

const { values } = parseArgs({
  options: {
    "hold-seconds": { default: "5", type: "string" },
    rounds: { default: "10", type: "string" },
    "timeout-seconds": { default: "20", type: "string" },
  },
});

const guildId = process.env["DISCORD_DEVELOPMENT_GUILD_ID"];
const lobbyId = process.env["LIVE_LOBBY_CHANNEL_ID"];
const tokens = (process.env["LOAD_BOT_TOKENS"] ?? "").split(",").filter((token) => token !== "");

if (guildId === undefined || lobbyId === undefined || tokens.length === 0) {
  throw new Error(
    "Set DISCORD_DEVELOPMENT_GUILD_ID, LIVE_LOBBY_CHANNEL_ID, and LOAD_BOT_TOKENS (helper bots).",
  );
}

if (tokens.includes(process.env["DISCORD_TOKEN"] ?? "")) {
  throw new Error("LOAD_BOT_TOKENS must not contain the LunaEcho bot's own token.");
}

const rounds = Number(values.rounds);
const holdMilliseconds = Number(values["hold-seconds"]) * 1_000;
const timeoutMilliseconds = Number(values["timeout-seconds"]) * 1_000;
const recorder = new LatencyRecorder();
let timeouts = 0;

type Helper = Readonly<{
  client: Client<true>;
  waitForChannel: (predicate: (id: string | null) => boolean) => Promise<string | null>;
}>;

async function startHelper(token: string): Promise<Helper> {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
  });
  const waiting = new Set<(channelId: string | null) => void>();

  // Only the gateway's own voice state events tell the helper where Discord put it.
  client.ws.on(
    GatewayDispatchEvents.VoiceStateUpdate,
    (data: { channel_id: string | null; guild_id?: string; user_id: string }) => {
      if (data.guild_id === guildId && data.user_id === client.user?.id) {
        waiting.forEach((resolve) => {
          resolve(data.channel_id);
        });
      }
    },
  );

  await client.login(token);
  await new Promise<void>((resolve) =>
    client.once(Events.ClientReady, () => {
      resolve();
    }),
  );

  return {
    client: client as Client<true>,
    waitForChannel: (predicate) =>
      new Promise((resolve) => {
        const timer = setTimeout(() => {
          waiting.delete(check);
          resolve(null);
        }, timeoutMilliseconds);
        const check = (channelId: string | null): void => {
          if (predicate(channelId)) {
            clearTimeout(timer);
            waiting.delete(check);
            resolve(channelId);
          }
        };
        waiting.add(check);
      }),
  };
}

function setVoiceChannel(helper: Helper, channelId: string | null): void {
  const guild = helper.client.guilds.cache.get(guildId ?? "");

  if (guild === undefined) {
    throw new Error(`Helper ${helper.client.user.tag} is not in the test server`);
  }

  // A bare voice state update is enough for Discord to place the bot; no audio is sent.
  guild.shard.send({
    d: { channel_id: channelId, guild_id: guild.id, self_deaf: true, self_mute: true },
    op: GatewayOpcodes.VoiceStateUpdate,
  });
}

async function runHelper(helper: Helper): Promise<void> {
  for (let round = 0; round < rounds; round += 1) {
    const moved = helper.waitForChannel((channelId) => channelId !== null && channelId !== lobbyId);
    const room = await recorder.measure("live.lobby-to-room", async () => {
      setVoiceChannel(helper, lobbyId ?? null);
      return moved;
    });

    if (room === null) {
      timeouts += 1;
    }

    await sleep(holdMilliseconds);
    const left = helper.waitForChannel((channelId) => channelId === null);
    setVoiceChannel(helper, null);
    await left;
    // Waits out LunaEcho's room-creation cooldown before the next round.
    await sleep(10_500);
  }
}

console.log(`Live voice load: ${tokens.length} helper bots × ${rounds} rounds in ${guildId}`);
const helpers = await Promise.all(tokens.map((token) => startHelper(token)));
await Promise.all(helpers.map((helper) => runHelper(helper)));
await Promise.all(helpers.map((helper) => helper.client.destroy()));

for (const operation of recorder.summary()) {
  console.log(
    `${operation.operation}: ${operation.count} runs · p50 ${operation.p50Ms} ms · p95 ${operation.p95Ms} ms · max ${operation.maxMs} ms`,
  );
}

console.log(`Timeouts (no room within ${timeoutMilliseconds / 1_000}s): ${timeouts}`);
process.exitCode = timeouts > 0 ? 1 : 0;
