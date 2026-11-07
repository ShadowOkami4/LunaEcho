/**
 * Which bot's settings a page edits in a server. Without a bot id it is LunaEcho itself (the
 * Cloud database); with one it is the signed-in user's Custom bot, which keeps its own database.
 * A server can have both, each with its own settings. Safe to use in client components.
 */
export type Scope = Readonly<{ botId?: string | undefined; guildId: string }>;

/** The settings pages of a scope, for example /bots/<bot>/servers/<server>. */
export function scopeBase(scope: Scope): string {
  return scope.botId === undefined
    ? `/servers/${scope.guildId}`
    : `/bots/${scope.botId}/servers/${scope.guildId}`;
}
