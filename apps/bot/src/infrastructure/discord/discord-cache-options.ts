import { Options, type ClientOptions, type GuildMember, type User } from "discord.js";

/**
 * A guild member is only needed while one of their messages or commands is being handled, and
 * every message event carries its author's member data. A small working set per guild is enough.
 */
export const maximumCachedMembersPerGuild = 100;

const userSweepIntervalSeconds = 3_600;

/**
 * Bounds the discord.js caches, which otherwise are by far the largest memory consumer of the
 * process (see docs/resource-measurements.md):
 *
 * - Messages are not cached at all. LunaEcho handles each message once when it arrives and
 *   fetches history on demand, while the default would retain 200 messages per channel.
 * - Members are limited per guild, keeping the bot's own member for permission checks.
 * - Users no guild references any more are swept hourly. They are not limited directly, because
 *   a cached member without its user is unusable.
 */
export function createDiscordCacheOptions(): Pick<ClientOptions, "makeCache" | "sweepers"> {
  return {
    makeCache: Options.cacheWithLimits({
      ...Options.DefaultMakeCacheSettings,
      GuildMemberManager: {
        keepOverLimit: (member: GuildMember) => member.id === member.client.user.id,
        maxSize: maximumCachedMembersPerGuild,
      },
      MessageManager: 0,
      ReactionManager: 0,
    }),
    sweepers: {
      ...Options.DefaultSweeperSettings,
      users: {
        filter: sweepUsersWithoutCachedMember,
        interval: userSweepIntervalSeconds,
      },
    },
  };
}

/** Builds the predicate for one sweep: true removes the user from the cache. */
export function sweepUsersWithoutCachedMember(): (user: User) => boolean {
  let referencedUserIds: Set<string> | undefined;

  return (user) => {
    if (user.id === user.client.user.id) {
      return false;
    }

    // Collected once per sweep, on the first user, instead of once per user.
    if (referencedUserIds === undefined) {
      referencedUserIds = new Set();

      for (const guild of user.client.guilds.cache.values()) {
        for (const memberId of guild.members.cache.keys()) {
          referencedUserIds.add(memberId);
        }
      }
    }

    return !referencedUserIds.has(user.id);
  };
}
