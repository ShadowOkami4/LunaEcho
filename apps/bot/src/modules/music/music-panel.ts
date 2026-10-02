import {
  formatTrackDuration,
  type ControlResult,
  type LoopMode,
  type MusicRequester,
  type MusicService,
  type MusicSettingsService,
  type MusicTrack,
  type SessionSnapshot,
} from "@lunaecho/modules";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  type Interaction,
  type MessageActionRowComponentBuilder,
} from "discord.js";

import type { PanelOptions } from "../../infrastructure/discord/components/panel.js";

export const musicPanelPrefix = "music:";

export const musicPanelActions = [
  "pause",
  "skip",
  "stop",
  "loop",
  "shuffle",
  "volume-down",
  "volume-up",
  "refresh",
] as const;

export type MusicPanelAction = (typeof musicPanelActions)[number];

const visibleQueueEntries = 5;
const volumeStep = 10;
const nextLoopMode = { off: "track", queue: "off", track: "queue" } as const satisfies Record<
  LoopMode,
  LoopMode
>;
const loopLabels = { off: "Loop: off", queue: "Loop: queue", track: "Loop: song" } as const;

export const controlMessages = {
  done: "",
  "no-session": "Nothing is playing right now.",
  "not-allowed": "Only members with the DJ role can do that here.",
  "not-in-channel": "Join the voice channel the music is playing in first.",
} as const satisfies Record<ControlResult, string>;

export function formatTrack(track: MusicTrack): string {
  const title = track.uri === null ? track.title : `[${track.title}](${track.uri})`;
  const duration = track.isStream ? "live" : formatTrackDuration(track.durationMilliseconds);
  return `${title} · ${track.author} · \`${duration}\``;
}

/** Who is acting, from any interaction inside a cached guild. */
export async function resolveMusicRequester(
  settings: MusicSettingsService,
  interaction: Interaction<"cached">,
): Promise<MusicRequester> {
  const djRoleId = (await settings.get(interaction.guildId)).djRoleId;

  return {
    isDj:
      interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild) ||
      (djRoleId !== null && interaction.member.roles.cache.has(djRoleId)),
    textChannelId: interaction.channelId,
    userId: interaction.user.id,
    voiceChannelId: interaction.guild.voiceStates.cache.get(interaction.user.id)?.channelId ?? null,
  };
}

function button(
  action: MusicPanelAction,
  label: string,
  style: ButtonStyle = ButtonStyle.Secondary,
): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(`${musicPanelPrefix}${action}`)
    .setLabel(label)
    .setStyle(style);
}

/** The player: what is playing, what comes next, and buttons for every control. */
export function createMusicPlayerPanel(
  session: SessionSnapshot | undefined,
  notice?: string,
): PanelOptions {
  const prefix = notice === undefined || notice === "" ? "" : `> ${notice}\n\n`;

  if (session?.current === undefined) {
    return {
      body: `${prefix}Nothing is playing. Start something with \`/music play\`.`,
      title: "Music player",
      tone: "neutral",
    };
  }

  const upcoming = session.upcoming
    .slice(0, visibleQueueEntries)
    .map((track, index) => `\`${index + 1}.\` ${formatTrack(track)}`);
  const hidden = session.upcoming.length - upcoming.length;
  const controls = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    button("pause", session.paused ? "Resume" : "Pause", ButtonStyle.Primary),
    button("skip", "Skip"),
    button("stop", "Stop", ButtonStyle.Danger),
    button("loop", loopLabels[session.loopMode]),
    button("shuffle", "Shuffle"),
  );
  const levels = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    button("volume-down", `Volume −${volumeStep}`),
    button("volume-up", `Volume +${volumeStep}`),
    button("refresh", "Refresh"),
  );

  return {
    body: [
      `${prefix}**Now ${session.paused ? "paused" : "playing"}:** ${formatTrack(session.current)}`,
      `-# Requested by <@${session.current.requesterId}>`,
      "",
      "### Up next",
      ...(upcoming.length === 0 ? ["The queue is empty."] : upcoming),
      ...(hidden > 0 ? [`…and ${hidden} more`] : []),
    ].join("\n"),
    footer: `Volume ${session.volume}% · ${loopLabels[session.loopMode]}`,
    rows: [controls, levels],
    title: "Music player",
    tone: session.paused ? "neutral" : "success",
  };
}

/** Runs one panel button against the music service. */
export function runMusicPanelAction(
  music: MusicService,
  guildId: string,
  requester: MusicRequester,
  action: MusicPanelAction,
): Promise<ControlResult> {
  const session = music.getSession(guildId);

  switch (action) {
    case "pause":
      return music.setPaused(guildId, requester, session?.paused !== true);
    case "skip":
      return music.skip(guildId, requester);
    case "stop":
      return music.stop(guildId, requester);
    case "loop":
      return music.setLoopMode(guildId, requester, nextLoopMode[session?.loopMode ?? "off"]);
    case "shuffle":
      return music.shuffle(guildId, requester);
    case "volume-down":
    case "volume-up":
      return music.setVolume(
        guildId,
        requester,
        (session?.volume ?? 0) + (action === "volume-up" ? volumeStep : -volumeStep),
      );
    case "refresh":
      return Promise.resolve(session === undefined ? "no-session" : "done");
  }
}
