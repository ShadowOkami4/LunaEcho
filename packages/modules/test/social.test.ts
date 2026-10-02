import type { DatabaseConnection } from "@lunaecho/db";
import { createTestDatabase, resetTestDatabase } from "@lunaecho/db/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  fetchYouTubeVideos,
  normalizeTwitchLogin,
  parseYouTubeFeed,
  renderSocialMessage,
  resolveYouTubeChannel,
  selectNewItems,
  SocialFeedInputError,
  SocialFeedService,
  type SocialItem,
} from "../src/index.js";

const feedXml = `<?xml version="1.0"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015">
  <title>Luna &amp; Friends</title>
  <author><name>Luna &amp; Friends</name></author>
  <entry>
    <yt:videoId>old</yt:videoId>
    <title>First</title>
    <author><name>Luna &amp; Friends</name></author>
    <published>2026-01-01T00:00:00+00:00</published>
  </entry>
  <entry>
    <yt:videoId>new</yt:videoId>
    <title>Tom &amp; Jerry &quot;live&quot;</title>
    <author><name>Luna &amp; Friends</name></author>
    <published>2026-01-02T00:00:00+00:00</published>
  </entry>
</feed>`;

const item = (id: string): SocialItem => ({
  creatorName: "Luna",
  id,
  publishedAt: new Date(),
  title: id,
  url: `https://youtu.be/${id}`,
});

describe("YouTube feeds", () => {
  it("parses entries newest first and decodes entities", () => {
    const items = parseYouTubeFeed(feedXml);

    expect(items.map((entry) => entry.id)).toEqual(["new", "old"]);
    expect(items[0]).toMatchObject({
      creatorName: "Luna & Friends",
      title: 'Tom & Jerry "live"',
      url: "https://www.youtube.com/watch?v=new",
    });
  });

  it("retries the feed when YouTube answers 404 for an existing channel", async () => {
    let calls = 0;
    const fetcher = (() => {
      calls += 1;
      return Promise.resolve(
        calls === 1 ? new Response("", { status: 404 }) : new Response(feedXml),
      );
    }) as typeof fetch;

    await expect(fetchYouTubeVideos("UC1234567890123456789012", fetcher)).resolves.toHaveLength(2);
    expect(calls).toBe(2);
  });

  it("does not retry client errors other than 404", async () => {
    let calls = 0;
    const fetcher = (() => {
      calls += 1;
      return Promise.resolve(new Response("", { status: 403 }));
    }) as typeof fetch;

    await expect(fetchYouTubeVideos("UC1234567890123456789012", fetcher)).rejects.toThrow("403");
    expect(calls).toBe(1);
  });

  it("resolves a handle through the channel page", async () => {
    const channelId = "UC1234567890123456789012";
    const fetcher = ((url: string) =>
      Promise.resolve(
        new Response(url.includes("@luna") ? `{"externalId":"${channelId}"}` : feedXml),
      )) as typeof fetch;

    await expect(resolveYouTubeChannel("https://youtube.com/@luna", fetcher)).resolves.toEqual({
      channelId,
      name: "Luna & Friends",
    });
    await expect(resolveYouTubeChannel("nothing here", fetcher)).rejects.toThrow();
  });
});

describe("selectNewItems", () => {
  it("remembers the newest item on the first check without announcing", () => {
    expect(selectNewItems(null, [item("b"), item("a")])).toEqual({ announce: [], newest: "b" });
  });

  it("announces newer items oldest first, at most three", () => {
    const items = ["f", "e", "d", "c", "b", "a"].map(item);

    expect(selectNewItems("c", items).announce.map((entry) => entry.id)).toEqual(["d", "e", "f"]);
    expect(selectNewItems("a", items).announce.map((entry) => entry.id)).toEqual(["d", "e", "f"]);
    expect(selectNewItems("f", items).announce).toEqual([]);
    expect(selectNewItems("gone", items).announce.map((entry) => entry.id)).toEqual(["f"]);
  });
});

describe("social helpers", () => {
  it("normalizes Twitch names and renders messages", () => {
    expect(normalizeTwitchLogin("https://www.twitch.tv/Luna_Echo")).toBe("luna_echo");
    expect(() => normalizeTwitchLogin("a b")).toThrow();
    expect(
      renderSocialMessage(
        {
          channelId: "c",
          displayName: "Luna",
          guildId: "g",
          id: "f",
          lastItemId: null,
          message: null,
          pingRoleId: null,
          platform: "youtube",
          sourceId: "UC",
        },
        item("x"),
      ),
    ).toBe("📺 **Luna** posted a new video: x\nhttps://youtu.be/x");
  });
});

describe("SocialFeedService", () => {
  let connection: DatabaseConnection;
  let now: Date;
  let service: SocialFeedService;
  const input = {
    channelId: "news",
    displayName: "Luna",
    guildId: "guild-1",
    message: null,
    pingRoleId: null,
    platform: "youtube",
    sourceId: "UC1234567890123456789012",
  } as const;

  beforeAll(async () => {
    connection = await createTestDatabase();
    service = new SocialFeedService(connection.db, () => now);
  });

  afterEach(async () => {
    await resetTestDatabase(connection.db);
  });

  afterAll(async () => {
    await connection.close();
  });

  it("rejects following the same creator twice", async () => {
    now = new Date("2026-01-01T00:00:00.000Z");
    await service.add(input, "admin");

    await expect(service.add(input, "admin")).rejects.toBeInstanceOf(SocialFeedInputError);
  });

  it("checks feeds on their interval and backs off after failures", async () => {
    now = new Date("2026-01-01T00:00:00.000Z");
    const feed = await service.add(input, "admin");

    await expect(service.takeDue("youtube")).resolves.toHaveLength(1);
    await expect(service.takeDue("twitch")).resolves.toEqual([]);

    now = new Date("2026-01-01T00:05:00.000Z");
    await service.recordFailure(feed.id);
    await expect(service.takeDue("youtube")).resolves.toHaveLength(1);

    // One failure doubles the interval to ten minutes.
    now = new Date("2026-01-01T00:14:00.000Z");
    await expect(service.takeDue("youtube")).resolves.toEqual([]);
    now = new Date("2026-01-01T00:15:00.000Z");
    await expect(service.takeDue("youtube")).resolves.toHaveLength(1);

    await service.recordSuccess(feed.id, "video-1");
    await expect(service.list("guild-1")).resolves.toMatchObject([{ lastItemId: "video-1" }]);
  });
});
