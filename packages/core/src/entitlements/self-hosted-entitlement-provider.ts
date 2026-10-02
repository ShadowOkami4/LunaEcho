import type { Clock } from "../time/clock.js";
import { FixedPlanEntitlementProvider } from "./runtime-entitlement-provider.js";

/** Self-Hosted servers always get every module, without billing. */
export class SelfHostedEntitlementProvider extends FixedPlanEntitlementProvider {
  public constructor(clock: Clock = () => new Date()) {
    super("self-hosted", clock);
  }
}
