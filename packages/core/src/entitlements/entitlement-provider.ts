import type { EntitlementSnapshot } from "./entitlement-model.js";

/**
 * Managed deployments implement this interface in private infrastructure code.
 * Feature code must never communicate with a billing provider directly.
 */
export interface EntitlementProvider {
  resolveForGuild(guildId: string): Promise<EntitlementSnapshot>;
}
