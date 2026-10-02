import {
  ChannelType,
  Client,
  GatewayIntentBits,
  type ClientUser,
  type Message,
  type User,
} from "discord.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createDiscordCacheOptions,
  maximumCachedMembersPerGuild,
  sweepUsersWithoutCachedMember,
} from "../../src/infrastructure/discord/discord-cache-options.js";

const guildId = "100000000000000001";
const channelId = "100000000000000002";
const botId = "100000000000000003";

function authorId(index: number): string {
  return String(200_000_000_000_000_000n + BigInt(index));
}

/** discord.js fills its caches through these internal methods when gateway events arrive. */
type Internal = Readonly<{ _add(data: unknown): unknown }>;

describe("createDiscordCacheOptions", () => {
  let client: Client<true>;

  beforeEach(() => {
    client = new Client({
      ...createDiscordCacheOptions(),
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
    });
    client.user = { id: botId } as ClientUser;
    (client.guilds as unknown as Internal)._add({
      channels: [
        {
          guild_id: guildId,
          id: channelId,
          name: "general",
          permission_overwrites: [],
          position: 0,
          type: ChannelType.GuildText,
        },
      ],
      id: guildId,
      members: [],
      name: "Test guild",
      owner_id: authorId(0),
      roles: [{ id: guildId, name: "@everyone", permissions: "0", position: 0 }],
      unavailable: false,
    });
  });

  afterEach(async () => {
    await client.destroy();
  });

  function receiveMessage(index: number, userId = authorId(index)): Message {
    const channel = client.channels.cache.get(channelId);

    if (channel?.type !== ChannelType.GuildText) {
      throw new Error("The test channel was not cached");
    }

    return (channel.messages as unknown as Internal)._add({
      attachments: [],
      author: { avatar: null, discriminator: "0", id: userId, username: `member-${index}` },
      channel_id: channelId,
      content: "hello",
      embeds: [],
      guild_id: guildId,
      id: String(300_000_000_000_000_000n + BigInt(index)),
      member: { joined_at: "2026-01-01T00:00:00.000Z", roles: [] },
      mentions: [],
      timestamp: "2026-01-01T00:00:00.000Z",
      type: 0,
    }) as Message;
  }

  function cachedMessages(): number {
    const channel = client.channels.cache.get(channelId);
    return channel?.type === ChannelType.GuildText ? channel.messages.cache.size : -1;
  }

  it("does not retain messages but still resolves each author's member", () => {
    const message = receiveMessage(1);

    expect(cachedMessages()).toBe(0);
    expect(message.content).toBe("hello");
    expect(message.member?.id).toBe(authorId(1));
  });

  it("limits cached members per guild without evicting the bot itself", () => {
    receiveMessage(0, botId);

    for (let index = 1; index <= maximumCachedMembersPerGuild * 2; index += 1) {
      receiveMessage(index);
    }

    const members = client.guilds.cache.get(guildId)?.members.cache;
    const newest = receiveMessage(maximumCachedMembersPerGuild * 2 + 1);

    expect(members?.size).toBe(maximumCachedMembersPerGuild);
    expect(members?.has(botId)).toBe(true);
    expect(members?.has(authorId(1))).toBe(false);
    expect(newest.member?.id).toBe(authorId(maximumCachedMembersPerGuild * 2 + 1));
  });

  it("sweeps only users that no guild caches as a member", () => {
    receiveMessage(0, botId);

    for (let index = 1; index <= maximumCachedMembersPerGuild + 10; index += 1) {
      receiveMessage(index);
    }

    const shouldSweep = sweepUsersWithoutCachedMember();
    const user = (id: string): User => {
      const cached = client.users.cache.get(id);

      if (cached === undefined) {
        throw new Error(`User ${id} was not cached`);
      }

      return cached;
    };

    expect(shouldSweep(user(authorId(1)))).toBe(true);
    expect(shouldSweep(user(authorId(maximumCachedMembersPerGuild + 10)))).toBe(false);
    expect(shouldSweep(user(botId))).toBe(false);
  });
});
