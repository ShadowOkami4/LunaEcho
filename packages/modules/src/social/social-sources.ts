/** One announceable item: a video, or a live stream. */
export type SocialItem = Readonly<{
  creatorName: string;
  id: string;
  publishedAt: Date;
  title: string;
  url: string;
}>;

export type Fetcher = typeof fetch;

const userAgent = "LunaEcho (https://shadowokami.com/LunaEcho)";
const requestTimeoutMilliseconds = 10_000;

export class SocialSourceError extends Error {
  public constructor(
    message: string,
    /** The HTTP status, when the source answered with an error. */
    public readonly status?: number,
  ) {
    super(message);
    this.name = "SocialSourceError";
  }
}

function decodeXml(text: string): string {
  return text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function tag(xml: string, name: string): string | undefined {
  const match = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(xml);
  return match?.[1] === undefined ? undefined : decodeXml(match[1].trim());
}

/** Parses a YouTube channel feed, newest video first. */
export function parseYouTubeFeed(xml: string): SocialItem[] {
  const creatorName = tag(xml.split("<entry>")[0] ?? "", "name") ?? "YouTube";
  return xml
    .split("<entry>")
    .slice(1)
    .flatMap((entry) => {
      const id = tag(entry, "yt:videoId");
      const published = tag(entry, "published");

      if (id === undefined || published === undefined) {
        return [];
      }

      return [
        {
          creatorName: tag(entry, "name") ?? creatorName,
          id,
          publishedAt: new Date(published),
          title: tag(entry, "title") ?? "New video",
          url: `https://www.youtube.com/watch?v=${id}`,
        },
      ];
    })
    .sort((left, right) => right.publishedAt.getTime() - left.publishedAt.getTime());
}

const channelIdPattern = /^UC[\w-]{22}$/;

/**
 * Accepts a channel id, a channel URL, or a handle (@name or its URL) and returns the channel id
 * and name. Handles need one request to the channel page.
 */
export async function resolveYouTubeChannel(
  input: string,
  fetcher: Fetcher = fetch,
): Promise<Readonly<{ channelId: string; name: string }>> {
  const value = input.trim();
  const direct = /(?:youtube\.com\/channel\/)?(UC[\w-]{22})/.exec(value)?.[1];
  let channelId = direct;

  if (channelId === undefined) {
    const handle = /(?:youtube\.com\/)?(@[\w.-]{3,30})/.exec(value)?.[1];

    if (handle === undefined) {
      throw new SocialSourceError("Enter a YouTube channel link, channel id, or @handle.");
    }

    const page = await request(fetcher, `https://www.youtube.com/${handle}`);
    channelId = /"(?:externalId|channelId)":"(UC[\w-]{22})"/.exec(page)?.[1];

    if (channelId === undefined || !channelIdPattern.test(channelId)) {
      throw new SocialSourceError(`YouTube has no channel ${handle}.`);
    }
  }

  const feed = await requestFeed(fetcher, channelId);
  return { channelId, name: tag(feed.split("<entry>")[0] ?? "", "title") ?? channelId };
}

export async function fetchYouTubeVideos(
  channelId: string,
  fetcher: Fetcher = fetch,
): Promise<SocialItem[]> {
  return parseYouTubeFeed(await requestFeed(fetcher, channelId));
}

/** YouTube's feed endpoint now and then answers 404 or 5xx for channels that exist. */
const feedAttempts = 3;
const feedRetryDelayMilliseconds = 1_000;

async function requestFeed(fetcher: Fetcher, channelId: string): Promise<string> {
  const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await request(fetcher, url);
    } catch (error) {
      const retryable =
        error instanceof SocialSourceError &&
        (error.status === 404 || (error.status !== undefined && error.status >= 500));

      if (!retryable || attempt >= feedAttempts) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, feedRetryDelayMilliseconds * attempt));
    }
  }
}

async function request(fetcher: Fetcher, url: string, init: RequestInit = {}): Promise<string> {
  const headers = new Headers(init.headers);
  headers.set("User-Agent", userAgent);
  const response = await fetcher(url, {
    ...init,
    headers,
    signal: AbortSignal.timeout(requestTimeoutMilliseconds),
  });

  if (!response.ok) {
    throw new SocialSourceError(
      `${new URL(url).hostname} answered ${response.status}`,
      response.status,
    );
  }

  return response.text();
}

interface TwitchStream {
  id: string;
  title: string;
  user_login: string;
  user_name: string;
  started_at: string;
}

/** Asks Twitch which of up to 100 logins are live, with an app access token. */
export class TwitchClient {
  private token: Readonly<{ expiresAt: number; value: string }> | undefined;

  public constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly fetcher: Fetcher = fetch,
  ) {}

  public async liveStreams(logins: readonly string[]): Promise<Map<string, SocialItem>> {
    const live = new Map<string, SocialItem>();

    for (let start = 0; start < logins.length; start += 100) {
      const query = logins
        .slice(start, start + 100)
        .map((login) => `user_login=${encodeURIComponent(login)}`)
        .join("&");
      const body = JSON.parse(
        await request(this.fetcher, `https://api.twitch.tv/helix/streams?${query}`, {
          headers: {
            Authorization: `Bearer ${await this.accessToken()}`,
            "Client-Id": this.clientId,
          },
        }),
      ) as { data: TwitchStream[] };

      for (const stream of body.data) {
        live.set(stream.user_login.toLowerCase(), {
          creatorName: stream.user_name,
          id: stream.id,
          publishedAt: new Date(stream.started_at),
          title: stream.title,
          url: `https://twitch.tv/${stream.user_login}`,
        });
      }
    }

    return live;
  }

  private async accessToken(): Promise<string> {
    if (this.token !== undefined && this.token.expiresAt > Date.now() + 60_000) {
      return this.token.value;
    }

    const body = JSON.parse(
      await request(this.fetcher, "https://id.twitch.tv/oauth2/token", {
        body: new URLSearchParams({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: "client_credentials",
        }),
        method: "POST",
      }),
    ) as { access_token: string; expires_in: number };
    this.token = { expiresAt: Date.now() + body.expires_in * 1_000, value: body.access_token };
    return body.access_token;
  }
}

export function normalizeTwitchLogin(input: string): string {
  const login = (/twitch\.tv\/([\w]+)/.exec(input)?.[1] ?? input)
    .trim()
    .replace(/^@/, "")
    .toLowerCase();

  if (!/^\w{3,25}$/.test(login)) {
    throw new SocialSourceError("Enter a Twitch channel name or link.");
  }

  return login;
}
