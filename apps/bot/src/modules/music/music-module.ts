import type { LunaDatabase } from "@lunaecho/db";
import {
  DrizzleMusicSettingsRepository,
  MusicService,
  MusicSettingsService,
} from "@lunaecho/modules";

import type { AppConfig } from "../../config/environment.js";
import {
  listen,
  type BotModule,
  type ModuleContext,
} from "../../infrastructure/discord/bot-module.js";
import { DiscordMusicNotifier } from "./discord-music-notifier.js";
import { LavalinkMusicBackend } from "./lavalink-music-backend.js";
import { createMusicCommand } from "./music-command.js";
import { MusicPanelHandler } from "./music-panel-handler.js";

export function createMusicModule(
  context: ModuleContext,
  database: LunaDatabase,
  config: AppConfig,
): Readonly<{ module: BotModule; music: MusicService | undefined }> {
  const logger = context.logger.child({ component: "music" });
  const settings = new MusicSettingsService(new DrizzleMusicSettingsRepository(database));
  const notifier = new DiscordMusicNotifier(context.client, logger);
  const lavalink = config.lavalink;
  const music =
    lavalink === undefined
      ? undefined
      : new MusicService(
          new LavalinkMusicBackend({
            client: context.client,
            logger,
            nodes: [
              { auth: lavalink.password, name: "main", secure: lavalink.secure, url: lavalink.url },
            ],
            searchSources: config.music.searchSources,
          }),
          {
            canPlay: (guildId) => context.moduleRuns(guildId, "music"),
            isDjRestricted: async (guildId) => (await settings.get(guildId)).djRoleId !== null,
            maximumSessions: config.music.maximumSessions,
            onError: (error, guildId) => {
              logger.error({ err: error, guildId }, "Music session failed");
            },
            onNotice: (notice) => {
              notifier.notify(notice);
            },
            resolveDefaultVolume: async (guildId) => (await settings.get(guildId)).defaultVolume,
          },
        );

  if (music === undefined) {
    logger.info("No Lavalink node configured; music commands will report it as unavailable");
  }

  return {
    module: {
      commands: [createMusicCommand({ music, settings })],
      components: [new MusicPanelHandler(music, settings)],
      invalidate: (guildId) => {
        settings.invalidate(guildId);
      },
      listeners:
        music === undefined
          ? []
          : [
              // A player left alone in its channel disconnects after the idle timeout.
              listen("voiceStateUpdate", "music.listeners", (oldState, newState) => {
                const guild = newState.guild;
                const session = music.getSession(guild.id);

                if (
                  session !== undefined &&
                  [oldState.channelId, newState.channelId].includes(session.voiceChannelId)
                ) {
                  // Voice states rather than channel members: the member cache is small.
                  const listeners = guild.voiceStates.cache.filter(
                    (state) =>
                      state.channelId === session.voiceChannelId &&
                      state.id !== guild.client.user.id &&
                      state.member?.user.bot !== true,
                  ).size;
                  music.handleListenerCount(guild.id, session.voiceChannelId, listeners);
                }

                return Promise.resolve();
              }),
            ],
      name: "music",
      resources: music === undefined ? [] : [{ close: () => music.shutdown() }],
    },
    music,
  };
}
