import { EntitlementService, SelfHostedEntitlementProvider } from "@lunaecho/core";
import pino from "pino";
import { describe, expect, it, vi } from "vitest";

import { LunaApplication } from "../../src/app/luna-application.js";
import type { BotGateway } from "../../src/infrastructure/discord/discord-gateway.js";
import { createTestModerationActionService } from "../helpers/create-test-moderation-action-service.js";
import { createTestModerationService } from "../helpers/create-test-moderation-service.js";
import { createTestModuleService } from "../helpers/create-test-module-service.js";

function createTestApplication(): {
  application: LunaApplication;
  connect: ReturnType<typeof vi.fn<BotGateway["connect"]>>;
  disconnect: ReturnType<typeof vi.fn<BotGateway["disconnect"]>>;
} {
  const connect = vi.fn<BotGateway["connect"]>().mockResolvedValue(undefined);
  const disconnect = vi.fn<BotGateway["disconnect"]>().mockResolvedValue(undefined);
  const gateway: BotGateway = { connect, disconnect };
  const entitlements = new EntitlementService(new SelfHostedEntitlementProvider());
  const moderationSettings = createTestModerationService();
  const moderationActions = createTestModerationActionService();

  return {
    application: new LunaApplication(gateway, pino({ level: "silent" }), {
      entitlements,
      moderationActions,
      moderationSettings,
      moduleSettings: createTestModuleService(),
    }),
    connect,
    disconnect,
  };
}

describe("LunaApplication", () => {
  it("starts and stops exactly once", async () => {
    const { application, connect, disconnect } = createTestApplication();

    await Promise.all([application.start(), application.start()]);
    expect(application.state).toBe("running");
    expect(connect).toHaveBeenCalledOnce();

    await Promise.all([application.stop(), application.stop()]);
    expect(application.state).toBe("stopped");
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("moves to stopped when startup fails", async () => {
    const { application, connect } = createTestApplication();
    connect.mockRejectedValueOnce(new Error("Discord unavailable"));

    await expect(application.start()).rejects.toThrow("Discord unavailable");
    expect(application.state).toBe("stopped");
  });
});
