/**
 * Load simulation for Voice Rooms and Music against simulated Discord and Lavalink.
 *
 *   npm run stress -- --scenario all --guilds 500 --duration 60
 *   npm run soak   -- --duration 3600
 *
 * Options: --scenario voice|music|all, --guilds, --members, --rate (actions per guild per
 * second), --duration (seconds), --latency (simulated API round trip in ms), --database
 * memory|pglite|postgres (postgres uses DATABASE_URL), --sessions (music session limit),
 * --seed, --sample (seconds between samples), --warmup (seconds ignored for leak detection).
 */
import "../src/config/load-env.js";

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { connectDatabase, type DatabaseConnection } from "@lunaecho/db";
import { createTestDatabase } from "@lunaecho/db/testing";
import { DrizzleVoiceRoomRepository, type VoiceRoomRepository } from "@lunaecho/modules";
import { InMemoryVoiceRoomRepository } from "@lunaecho/modules/testing";

import {
  createRandom,
  heapGrowthPerHour,
  LatencyRecorder,
  ProcessSampler,
  type ProcessSample,
  type StateProbes,
} from "./metrics.js";
import { runMusicLoad, type MusicLoadReport } from "./music-load.js";
import { runVoiceRoomLoad, type VoiceRoomLoadReport } from "./voice-room-load.js";

const { values } = parseArgs({
  options: {
    database: { default: "memory", type: "string" },
    duration: { default: "60", type: "string" },
    guilds: { default: "200", type: "string" },
    latency: { default: "80", type: "string" },
    members: { default: "40", type: "string" },
    rate: { default: "2", type: "string" },
    sample: { default: "5", type: "string" },
    scenario: { default: "all", type: "string" },
    seed: { default: "1", type: "string" },
    sessions: { default: "200", type: "string" },
    "track-length": { default: "3000", type: "string" },
    warmup: { default: "30", type: "string" },
  },
});

const options = {
  database: values.database,
  durationSeconds: Number(values.duration),
  guilds: Number(values.guilds),
  latencyMilliseconds: Number(values.latency),
  membersPerGuild: Number(values.members),
  rate: Number(values.rate),
  sampleSeconds: Number(values.sample),
  scenario: values.scenario,
  seed: Number(values.seed),
  sessions: Number(values.sessions),
  trackLengthMilliseconds: Number(values["track-length"]),
  warmupSeconds: Number(values.warmup),
};

if (!["voice", "music", "all"].includes(options.scenario)) {
  throw new Error("--scenario must be voice, music, or all");
}

async function openVoiceRepository(): Promise<{
  close: () => Promise<void>;
  repository: VoiceRoomRepository;
}> {
  if (options.database === "memory") {
    return { close: () => Promise.resolve(), repository: new InMemoryVoiceRoomRepository() };
  }

  let connection: DatabaseConnection;

  if (options.database === "pglite") {
    connection = await createTestDatabase();
  } else if (options.database === "postgres") {
    const url = process.env["DATABASE_URL"];

    if (url === undefined) {
      throw new Error("--database postgres needs DATABASE_URL");
    }

    connection = await connectDatabase({ connectionString: url });
  } else {
    throw new Error("--database must be memory, pglite, or postgres");
  }

  return { close: connection.close, repository: new DrizzleVoiceRoomRepository(connection.db) };
}

const recorder = new LatencyRecorder();
const probes: StateProbes = new Map();
const sampler = new ProcessSampler(probes);
const database = await openVoiceRepository();

console.log(`LunaEcho stress test · ${JSON.stringify(options)}`);
console.log("elapsed  cpu%   heapMB  rssMB  loopP99ms  state");
sampler.start(options.sampleSeconds * 1_000, (sample: ProcessSample) => {
  console.log(
    `${String(sample.elapsedSeconds).padStart(6)}s ${String(sample.cpuPercent).padStart(6)} ${String(sample.heapUsedMb).padStart(8)} ${String(sample.rssMb).padStart(6)} ${String(sample.eventLoopDelayP99Ms).padStart(9)}  ${JSON.stringify(sample.state)}`,
  );
});

const random = createRandom(options.seed);
const [voice, music] = await Promise.all([
  options.scenario === "music"
    ? Promise.resolve(undefined)
    : runVoiceRoomLoad({
        actionsPerGuildPerSecond: options.rate,
        apiLatencyMilliseconds: options.latencyMilliseconds,
        durationSeconds: options.durationSeconds,
        guilds: options.guilds,
        membersPerGuild: options.membersPerGuild,
        probes,
        random,
        recorder,
        repository: database.repository,
      }),
  options.scenario === "voice"
    ? Promise.resolve(undefined)
    : runMusicLoad({
        actionsPerGuildPerSecond: options.rate,
        backendLatencyMilliseconds: Math.round(options.latencyMilliseconds / 4),
        durationSeconds: options.durationSeconds,
        guilds: options.guilds,
        maximumSessions: options.sessions,
        probes,
        random,
        recorder,
        trackLengthMilliseconds: options.trackLengthMilliseconds,
      }),
]);

sampler.stop();
await database.close();

const peak = (field: Exclude<keyof ProcessSample, "state">): number =>
  Math.max(0, ...sampler.samples.map((sample) => sample[field]));
const violations = [...(voice?.invariantViolations ?? []), ...(music?.invariantViolations ?? [])];
const report: {
  heapGrowthMbPerHour: number;
  music: MusicLoadReport | undefined;
  operations: ReturnType<LatencyRecorder["summary"]>;
  options: typeof options;
  peaks: Record<string, number>;
  samples: readonly ProcessSample[];
  voice: VoiceRoomLoadReport | undefined;
} = {
  heapGrowthMbPerHour: heapGrowthPerHour(sampler.samples, options.warmupSeconds),
  music,
  operations: recorder.summary(),
  options,
  peaks: {
    cpuPercent: peak("cpuPercent"),
    eventLoopDelayP99Ms: peak("eventLoopDelayP99Ms"),
    heapUsedMb: peak("heapUsedMb"),
    rssMb: peak("rssMb"),
  },
  samples: sampler.samples,
  voice,
};

console.log("\noperation                      count  fail   p50ms   p95ms   p99ms    maxms");
for (const operation of report.operations) {
  console.log(
    `${operation.operation.padEnd(28)} ${String(operation.count).padStart(7)} ${String(operation.failures).padStart(5)} ${String(operation.p50Ms).padStart(7)} ${String(operation.p95Ms).padStart(7)} ${String(operation.p99Ms).padStart(7)} ${String(operation.maxMs).padStart(8)}`,
  );
}

console.log(`\nvoice: ${JSON.stringify(voice)}`);
console.log(`music: ${JSON.stringify(music)}`);
console.log(`peaks: ${JSON.stringify(report.peaks)}`);
console.log(`heap growth after warm-up: ${report.heapGrowthMbPerHour} MB/hour`);

const outputDirectory = join(process.cwd(), "stress-results");
mkdirSync(outputDirectory, { recursive: true });
const file = join(
  outputDirectory,
  `${new Date().toISOString().replaceAll(":", "-")}-${options.scenario}.json`,
);
writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
console.log(`report: ${file}`);

if (violations.length > 0) {
  console.error(`\nINVARIANT VIOLATIONS:\n- ${violations.join("\n- ")}`);
  process.exitCode = 1;
} else {
  console.log("\nAll invariants held: no orphaned rooms, channels, sessions, or players.");
}
