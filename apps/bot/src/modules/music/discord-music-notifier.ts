import type { AppLogger } from "@lunaecho/core";
import type { MusicNotice } from "@lunaecho/modules";
import { MessageFlags, type Client } from "discord.js";

import { createPanel } from "../../infrastructure/discord/components/panel.js";

/** Posts music problems to the text channel where playback was requested. */
export class DiscordMusicNotifier {
  public constructor(
    private readonly client: Client,
    private readonly logger: AppLogger,
  ) {}

  public notify(notice: MusicNotice): void {
    if (notice.textChannelId === null) {
      return;
    }

    void this.send(notice.textChannelId, notice).catch((error: unknown) => {
      // A missing permission to write in that channel must not affect playback.
      this.logger.warn({ err: error, guildId: notice.guildId }, "Could not post a music notice");
    });
  }

  private async send(channelId: string, notice: MusicNotice): Promise<void> {
    const channel = await this.client.channels.fetch(channelId);

    if (!channel?.isSendable()) {
      return;
    }

    const panel =
      notice.kind === "track-failed"
        ? createPanel({
            body: `**${notice.track.title}** (${notice.track.source}) could not be played${notice.reason === null ? "." : `:\n-# ${notice.reason}`}\nSkipping to the next song.`,
            title: "Song skipped",
            tone: "warning",
          })
        : createPanel({
            body: "Several songs in a row could not be played, so the music stopped. The audio source may be blocking playback right now; try another song or source.",
            title: "Music stopped",
            tone: "danger",
          });

    await channel.send({
      allowedMentions: { parse: [] },
      components: [panel],
      flags: MessageFlags.IsComponentsV2,
    });
  }
}
