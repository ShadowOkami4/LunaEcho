import type { MusicService, MusicSettingsService, PlayResult } from "@lunaecho/modules";
import {
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord.js";

import type { ChatInputCommand } from "../../infrastructure/discord/commands/chat-input-command.js";
import { respondWithPanelEphemerally } from "../../infrastructure/discord/commands/interaction-responder.js";
import { createMusicPlayerPanel, formatTrack, resolveMusicRequester } from "./music-panel.js";

/** Settings such as the DJ role live in the dashboard; Discord only plays and controls music. */
export const musicCommandData: RESTPostAPIChatInputApplicationCommandsJSONBody =
  new SlashCommandBuilder()
    .setName("music")
    .setDescription("Play music in your voice channel.")
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("play")
        .setDescription("Play a song or playlist, or add it to the queue.")
        .addStringOption((option) =>
          option
            .setName("query")
            .setDescription("A search term or a link.")
            .setMaxLength(500)
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("player").setDescription("Open the player with all controls."),
    )
    .toJSON();

export type MusicCommandServices = Readonly<{
  /** Undefined when this LunaEcho instance has no Lavalink node configured. */
  music: MusicService | undefined;
  settings: MusicSettingsService;
}>;

export function describePlayResult(result: PlayResult): string {
  switch (result.kind) {
    case "playing":
    case "queued": {
      const first = result.tracks[0];
      const subject =
        result.playlistName === null
          ? first === undefined
            ? "Nothing"
            : formatTrack(first)
          : `**${result.playlistName}** (${result.tracks.length} songs)`;
      const dropped =
        result.dropped > 0 ? ` ${result.dropped} songs did not fit into the queue.` : "";

      return result.kind === "playing"
        ? `Started ${subject}.${dropped}`
        : `Added ${subject} at position ${result.position}.${dropped}`;
    }
    case "different-channel":
      return `The music is already playing in <#${result.voiceChannelId}>.`;
    case "module-off":
      return "Music is disabled in this server.";
    case "no-results":
      return "Nothing was found for that search.";
    case "not-in-voice":
      return "Join a voice channel first.";
    case "queue-full":
      return "The queue is full.";
    case "search-failed":
      return `The audio source reported an error: ${result.message}`;
    case "session-limit":
      return "LunaEcho is playing in too many servers right now. Try again later.";
  }
}

export function createMusicCommand(services: MusicCommandServices): ChatInputCommand {
  return {
    data: musicCommandData,
    guildOnly: true,
    requiredCapability: "music",

    async execute({ interaction }): Promise<void> {
      if (!interaction.inCachedGuild()) {
        throw new Error("Music command executed outside a cached guild");
      }

      if (services.music === undefined) {
        await respondWithPanelEphemerally(interaction, {
          body: "This LunaEcho instance has no Lavalink audio node configured. See docs/music.md.",
          title: "Music unavailable",
          tone: "warning",
        });
        return;
      }

      if (interaction.options.getSubcommand(true) === "player") {
        await respondWithPanelEphemerally(
          interaction,
          createMusicPlayerPanel(services.music.getSession(interaction.guildId)),
        );
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await services.music.play(
        interaction.guildId,
        await resolveMusicRequester(services.settings, interaction),
        interaction.options.getString("query", true),
      );
      await respondWithPanelEphemerally(
        interaction,
        createMusicPlayerPanel(
          services.music.getSession(interaction.guildId),
          describePlayResult(result),
        ),
      );
    },
  };
}
