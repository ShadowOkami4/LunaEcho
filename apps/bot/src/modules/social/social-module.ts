import { toError, type AppLogger } from "@lunaecho/core";
import type { LunaDatabase } from "@lunaecho/db";
import {
  fetchYouTubeVideos,
  renderSocialMessage,
  selectNewItems,
  SocialFeedService,
  TwitchClient,
  type SocialFeed,
  type SocialItem,
} from "@lunaecho/modules";
import type { Client } from "discord.js";

import type { AppConfig } from "../../config/environment.js";
import type { BotModule, ModuleContext } from "../../infrastructure/discord/bot-module.js";

const pollIntervalMilliseconds = 60_000;
/** Marks a Twitch feed whose creator was offline at the last check. */
const offline = "offline";

/** Checks followed creators and announces new videos and streams. */
export class SocialPoller {
  private running = false;
  private timer: ReturnType<typeof setInterval> | undefined;

  public constructor(
    private readonly feeds: SocialFeedService,
    private readonly client: Client,
    private readonly moduleRuns: (guildId: string) => Promise<boolean>,
    private readonly twitch: TwitchClient | undefined,
    private readonly logger: AppLogger,
  ) {}

  public start(): void {
    this.timer = setInterval(() => {
      void this.poll();
    }, pollIntervalMilliseconds);
    this.timer.unref();
    void this.poll();
  }

  public close(): Promise<void> {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
    }

    return Promise.resolve();
  }

  public async poll(): Promise<void> {
    // A slow feed must not let polls pile up.
    if (this.running) {
      return;
    }

    this.running = true;

    try {
      await this.pollYouTube();

      if (this.twitch !== undefined) {
        await this.pollTwitch(this.twitch);
      }
    } catch (error) {
      this.logger.error({ err: toError(error) }, "Checking social feeds failed");
    } finally {
      this.running = false;
    }
  }

  private async pollYouTube(): Promise<void> {
    const due = await this.feeds.takeDue("youtube");
    // Many servers may follow the same creator; the feed is fetched once per poll.
    const videos = new Map<string, Promise<SocialItem[]>>();

    for (const feed of due) {
      let items: SocialItem[];

      try {
        let request = videos.get(feed.sourceId);

        if (request === undefined) {
          request = fetchYouTubeVideos(feed.sourceId);
          videos.set(feed.sourceId, request);
        }

        items = await request;
      } catch (error) {
        this.logger.debug({ err: toError(error), feedId: feed.id }, "YouTube feed failed");
        await this.feeds.recordFailure(feed.id);
        continue;
      }

      const { announce, newest } = selectNewItems(feed.lastItemId, items);

      for (const item of announce) {
        await this.announce(feed, item);
      }

      await this.feeds.recordSuccess(feed.id, newest);
    }
  }

  private async pollTwitch(twitch: TwitchClient): Promise<void> {
    const due = await this.feeds.takeDue("twitch");

    if (due.length === 0) {
      return;
    }

    let live: Map<string, SocialItem>;

    try {
      live = await twitch.liveStreams([...new Set(due.map((feed) => feed.sourceId))]);
    } catch (error) {
      this.logger.warn({ err: toError(error) }, "Twitch did not answer");
      await Promise.all(due.map((feed) => this.feeds.recordFailure(feed.id)));
      return;
    }

    for (const feed of due) {
      const stream = live.get(feed.sourceId);
      const current = stream?.id ?? offline;

      // The first check only learns the current state, so adding a live creator posts nothing.
      if (stream !== undefined && feed.lastItemId !== null && feed.lastItemId !== current) {
        await this.announce(feed, stream);
      }

      await this.feeds.recordSuccess(feed.id, current);
    }
  }

  private async announce(feed: SocialFeed, item: SocialItem): Promise<void> {
    const channel = this.client.channels.cache.get(feed.channelId);

    if (channel?.isSendable() !== true || !(await this.moduleRuns(feed.guildId))) {
      return;
    }

    const content = renderSocialMessage(feed, item);

    try {
      await channel.send({
        allowedMentions: { roles: feed.pingRoleId === null ? [] : [feed.pingRoleId] },
        content: feed.pingRoleId === null ? content : `<@&${feed.pingRoleId}> ${content}`,
      });
    } catch (error) {
      this.logger.warn(
        { err: toError(error), feedId: feed.id, guildId: feed.guildId },
        "Could not post a social notification",
      );
    }
  }
}

export function createSocialModule(
  context: ModuleContext,
  database: LunaDatabase,
  config: Pick<AppConfig, "twitch">,
): BotModule {
  const logger = context.logger.child({ component: "social" });
  const poller = new SocialPoller(
    new SocialFeedService(database),
    context.client,
    (guildId) => context.moduleRuns(guildId, "social-notifications"),
    config.twitch === undefined
      ? undefined
      : new TwitchClient(config.twitch.clientId, config.twitch.clientSecret),
    logger,
  );

  return {
    name: "social-notifications",
    onReady: () => {
      poller.start();
      return Promise.resolve();
    },
    resources: [poller],
  };
}
