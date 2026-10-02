/** Discord permission bits the dashboard checks or requests. */
export const permissions = {
  addReactions: 1n << 6n,
  administrator: 1n << 3n,
  attachFiles: 1n << 15n,
  banMembers: 1n << 2n,
  connect: 1n << 20n,
  createPrivateThreads: 1n << 36n,
  embedLinks: 1n << 14n,
  kickMembers: 1n << 1n,
  manageChannels: 1n << 4n,
  manageGuild: 1n << 5n,
  manageMessages: 1n << 13n,
  manageRoles: 1n << 28n,
  manageThreads: 1n << 34n,
  moderateMembers: 1n << 40n,
  moveMembers: 1n << 24n,
  readMessageHistory: 1n << 16n,
  sendMessages: 1n << 11n,
  sendMessagesInThreads: 1n << 38n,
  speak: 1n << 21n,
  viewChannel: 1n << 10n,
} as const;

export type GuildAccess = Readonly<{ owner: boolean; permissions: string }>;

/**
 * Dashboard access mirrors Discord: only the owner, administrators, and members with Manage
 * Server may configure LunaEcho for a server. Discord computes these permissions itself.
 */
export function canManage(guild: GuildAccess): boolean {
  const granted = BigInt(guild.permissions);
  return (
    guild.owner ||
    (granted & permissions.administrator) !== 0n ||
    (granted & permissions.manageGuild) !== 0n
  );
}
