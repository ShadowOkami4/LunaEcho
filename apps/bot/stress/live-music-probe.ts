/**
 * Live music check on the test server: a helper bot joins a voice channel, plays one result per
 * search source through the same Lavalink node LunaEcho uses, and reports whether audio actually
 * advanced. Searching can succeed while playback is blocked, so only a moving position counts.
 *
 *   LOAD_BOT_TOKENS=helper LIVE_VOICE_CHANNEL_ID=... npm run live:music -- --query "lofi hip hop"
 */
import "../src/config/load-env.js";

import { parseArgs } from "node:util";

import { Client, Events, GatewayIntentBits } from "discord.js";
import { Connectors, LoadType, Shoukaku, type Player, type Track } from "shoukaku";

const { values } = parseArgs({
  options: {
    query: { default: "lofi hip hop", type: "string" },
    seconds: { default: "8", type: "string" },
    sources: { default: "ytsearch,scsearch", type: "string" },
  },
});

const guildId = process.env["DISCORD_DEVELOPMENT_GUILD_ID"];
const channelId = process.env["LIVE_VOICE_CHANNEL_ID"];
const token = (process.env["LOAD_BOT_TOKENS"] ?? "").split(",")[0] ?? "";
const lavalinkUrl = process.env["LAVALINK_URL"];
const lavalinkPassword = process.env["LAVALINK_PASSWORD"];

if (
  guildId === undefined ||
  channelId === undefined ||
  token === "" ||
  lavalinkUrl === undefined ||
  lavalinkPassword === undefined
) {
  throw new Error(
    "Set DISCORD_DEVELOPMENT_GUILD_ID, LIVE_VOICE_CHANNEL_ID, LOAD_BOT_TOKENS, LAVALINK_URL, and LAVALINK_PASSWORD.",
  );
}

if (token === process.env["DISCORD_TOKEN"]) {
  throw new Error("Use a helper bot, not the LunaEcho bot, for this check.");
}

const listenMilliseconds = Number(values.seconds) * 1_000;
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});
const shoukaku = new Shoukaku(new Connectors.DiscordJS(client), [
  { auth: lavalinkPassword, name: "probe", url: lavalinkUrl },
]);
shoukaku.on("error", (_name, error) => {
  console.error(`Lavalink error: ${error.message}`);
});

type ProbeResult = Readonly<{ detail: string; ok: boolean }>;

function listen(player: Player): Promise<ProbeResult> {
  return new Promise((resolve) => {
    let started = false;
    let lastPosition = 0;
    const finish = (result: ProbeResult): void => {
      clearTimeout(timer);
      player.removeAllListeners();
      resolve(result);
    };
    const timer = setTimeout(() => {
      finish(
        lastPosition > 1_000
          ? { detail: `audio advanced to ${Math.round(lastPosition / 1_000)} s`, ok: true }
          : {
              detail: started ? "started but the position never advanced" : "never started",
              ok: false,
            },
      );
    }, listenMilliseconds);

    player.on("start", () => {
      started = true;
    });
    player.on("update", (update) => {
      lastPosition = update.state.position;
    });
    player.on("exception", (event) => {
      finish({ detail: `exception: ${event.exception.message.split("\n")[0] ?? ""}`, ok: false });
    });
    player.on("end", (event) => {
      if (event.reason === "loadFailed") {
        finish({ detail: "Lavalink could not load the track", ok: false });
      }
    });
  });
}

client.once(Events.ClientReady, () => {
  void (async () => {
    // Shoukaku connects to Lavalink once the Discord client is ready.
    while (shoukaku.getIdealNode() === undefined) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    const node = shoukaku.getIdealNode();
    const player = await shoukaku.joinVoiceChannel({
      channelId,
      deaf: true,
      guildId,
      shardId: 0,
    });
    let failures = 0;

    for (const source of values.sources.split(",")) {
      const response = await node?.rest.resolve(`${source}:${values.query}`);
      const track: Track | undefined =
        response?.loadType === LoadType.SEARCH ? response.data[0] : undefined;

      if (track === undefined) {
        console.log(`${source}: no search result`);
        failures += 1;
        continue;
      }

      const result = listen(player);
      await player.playTrack({ track: { encoded: track.encoded }, volume: 30 });
      const outcome = await result;
      await player.stopTrack();
      failures += outcome.ok ? 0 : 1;
      console.log(
        `${source}: ${outcome.ok ? "PLAYS" : "FAILS"} — "${track.info.title}" (${track.info.sourceName}), ${outcome.detail}`,
      );
    }

    await shoukaku.leaveVoiceChannel(guildId);
    await client.destroy();
    // Shoukaku keeps reconnect timers alive, so the script ends explicitly.
    process.exit(failures > 0 ? 1 : 0);
  })();
});

await client.login(token);
