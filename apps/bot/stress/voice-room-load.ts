import {
  VoiceRoomService,
  type VoiceRoomEvent,
  type VoiceRoomRepository,
  type VoiceStateChange,
} from "@lunaecho/modules";
import { SimulatedVoicePlatform } from "@lunaecho/modules/testing";

import { sleep, type LatencyRecorder, type StateProbes } from "./metrics.js";

export type VoiceRoomLoadOptions = Readonly<{
  /** Voice actions per guild per second across all of its members. */
  actionsPerGuildPerSecond: number;
  apiLatencyMilliseconds: number;
  durationSeconds: number;
  guilds: number;
  membersPerGuild: number;
  probes: StateProbes;
  random: () => number;
  recorder: LatencyRecorder;
  repository: VoiceRoomRepository;
}>;

export type VoiceRoomLoadReport = Readonly<{
  actions: number;
  discordApiCalls: number;
  events: Readonly<Record<string, number>>;
  invariantViolations: readonly string[];
  peakOpenRooms: number;
}>;

const tickMilliseconds = 50;

/**
 * Members of many guilds join lobbies, hop between rooms, use owner controls, and leave, with
 * Discord's API round trips simulated. The real VoiceRoomService and repository do the work.
 */
export async function runVoiceRoomLoad(
  options: VoiceRoomLoadOptions,
): Promise<VoiceRoomLoadReport> {
  const { random, recorder } = options;
  const inFlight = new Set<Promise<unknown>>();
  const events: Record<string, number> = {};
  let actions = 0;
  let openRooms = 0;
  let peakOpenRooms = 0;

  const track = (promise: Promise<unknown>): void => {
    const guarded = promise.catch(() => undefined);
    inFlight.add(guarded);
    void guarded.finally(() => inFlight.delete(guarded));
  };

  const count = (result: readonly VoiceRoomEvent[]): void => {
    for (const event of result) {
      const key = event.kind === "creation-refused" ? `refused:${event.reason}` : event.kind;
      events[key] = (events[key] ?? 0) + 1;
      openRooms += event.kind === "room-created" ? 1 : event.kind === "room-deleted" ? -1 : 0;
      peakOpenRooms = Math.max(peakOpenRooms, openRooms);
    }
  };

  // Moves and disconnects performed by LunaEcho come back as gateway events, like on Discord.
  const platform: SimulatedVoicePlatform = new SimulatedVoicePlatform({
    apiLatencyMilliseconds: options.apiLatencyMilliseconds,
    onVoiceStateChange: (change) => {
      setImmediate(() => {
        track(
          recorder
            .measure("voice.gateway-follow-up", () => service.handleVoiceStateChange(change))
            .then(count),
        );
      });
    },
  });
  const service = new VoiceRoomService(options.repository, platform);
  options.probes.set("openRooms", () => openRooms);
  const guildIds = Array.from({ length: options.guilds }, (_, index) => `guild-${index}`);

  for (const guildId of guildIds) {
    platform.addChannel(guildId, `${guildId}:lobby`, "Join to create");
    platform.addChannel(guildId, `${guildId}:general`, "General");
    await service.saveLobby({
      actorId: "admin",
      categoryId: null,
      channelId: `${guildId}:lobby`,
      guildId,
      nameTemplate: "{user}'s Room",
      userLimit: 0,
    });
  }

  const pick = <Item>(items: readonly Item[]): Item | undefined =>
    items[Math.floor(random() * items.length)];

  const act = (guildId: string): void => {
    const userId = `member-${Math.floor(random() * options.membersPerGuild)}`;
    const current = platform.channelOf(guildId, userId);
    const roll = random();
    const change = (channelId: string | null, operation: string): void => {
      const stateChange: VoiceStateChange = platform.setMemberChannel(
        guildId,
        userId,
        channelId,
        userId,
      );
      track(
        recorder.measure(operation, () => service.handleVoiceStateChange(stateChange)).then(count),
      );
    };

    actions += 1;

    if (current === null) {
      change(roll < 0.6 ? `${guildId}:lobby` : `${guildId}:general`, "voice.join");
      return;
    }

    if (current === `${guildId}:lobby` || current === `${guildId}:general`) {
      track(
        service.listRooms(guildId).then((rooms) => {
          const room = pick(rooms);
          change(roll < 0.5 && room !== undefined ? room.channelId : null, "voice.hop-or-leave");
        }),
      );
      return;
    }

    const actor = { channelId: current, userId };

    if (roll < 0.2) {
      change(null, "voice.leave");
    } else if (roll < 0.35) {
      change(`${guildId}:lobby`, "voice.back-to-lobby");
    } else if (roll < 0.45) {
      track(
        recorder.measure("room.rename", () => service.renameRoom(guildId, actor, `Room ${roll}`)),
      );
    } else if (roll < 0.55) {
      track(
        recorder.measure("room.limit", () =>
          service.setUserLimit(guildId, actor, Math.floor(random() * 10)),
        ),
      );
    } else if (roll < 0.62) {
      track(recorder.measure("room.lock", () => service.setLocked(guildId, actor, random() < 0.5)));
    } else if (roll < 0.68) {
      track(recorder.measure("room.claim", () => service.claimRoom(guildId, actor)));
    } else if (roll < 0.72) {
      track(recorder.measure("room.info", () => service.getRoomInfo(guildId, actor)));
    }
  };

  const deadline = Date.now() + options.durationSeconds * 1_000;
  const actionsPerTick = (options.actionsPerGuildPerSecond * tickMilliseconds) / 1_000;
  let carry = 0;

  while (Date.now() < deadline) {
    carry += actionsPerTick;
    const whole = Math.floor(carry);
    carry -= whole;

    for (const guildId of guildIds) {
      for (let action = 0; action < whole; action += 1) {
        act(guildId);
      }
    }

    await sleep(tickMilliseconds);
  }

  // Everyone leaves; afterwards no room, record, or channel may remain.
  await drain(inFlight);

  for (const guildId of guildIds) {
    for (let member = 0; member < options.membersPerGuild; member += 1) {
      if (platform.channelOf(guildId, `member-${member}`) !== null) {
        const leave = platform.setMemberChannel(guildId, `member-${member}`, null);
        track(service.handleVoiceStateChange(leave).then(count));
      }
    }
  }

  await drain(inFlight);

  const violations: string[] = [];
  const storedRoomGuilds = await options.repository.listRoomGuildIds();

  // Leaves no test data behind when the run used a real database.
  for (const guildId of guildIds) {
    await service.removeLobby(guildId, `${guildId}:lobby`);
  }

  if (storedRoomGuilds.length > 0) {
    violations.push(
      `${storedRoomGuilds.length} guilds still have stored rooms after everyone left`,
    );
  }

  if (platform.channelCount !== guildIds.length * 2) {
    violations.push(
      `${platform.channelCount - guildIds.length * 2} simulated room channels were never deleted`,
    );
  }

  return {
    actions,
    discordApiCalls: platform.apiCalls,
    events,
    invariantViolations: violations,
    peakOpenRooms,
  };
}

/** Waits until no work is in flight, including follow-up events scheduled meanwhile. */
async function drain(inFlight: Set<Promise<unknown>>): Promise<void> {
  for (let quietRounds = 0; quietRounds < 3;) {
    if (inFlight.size === 0) {
      quietRounds += 1;
      await sleep(20);
      continue;
    }

    quietRounds = 0;
    await Promise.all([...inFlight]);
  }
}
