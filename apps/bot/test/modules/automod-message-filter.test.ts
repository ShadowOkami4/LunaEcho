import type { Message } from "discord.js";
import pino from "pino";
import { describe, expect, it, vi } from "vitest";

import { AutomodMessageFilter } from "../../src/modules/moderation/application/automod-message-filter.js";
import { AutomodDetector } from "../../src/modules/moderation/domain/automod-detector.js";
import { LocalHeuristicSafetyClassifier } from "../../src/modules/moderation/infrastructure/local-heuristic-safety-classifier.js";
import { DiscordModerationUserNotifier } from "../../src/modules/moderation/infrastructure/discord-moderation-user-notifier.js";
import { createTestModerationActionService } from "../helpers/create-test-moderation-action-service.js";
import { createTestModerationService } from "../helpers/create-test-moderation-service.js";

function createInviteMessage() {
  const deleteMessage = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const message = {
    attachments: new Map(),
    author: { bot: false, id: "user-1" },
    channelId: "channel-1",
    client: { user: { id: "bot-1" } },
    content: "Join https://discord.gg/example",
    delete: deleteMessage,
    guild: { name: "Test Guild" },
    guildId: "guild-1",
    id: "message-1",
    inGuild: () => true,
    mentions: { everyone: false, roles: new Map(), users: new Map() },
    member: {
      permissions: { any: () => false },
      roles: { cache: new Map() },
    },
    poll: null,
    webhookId: null,
  } as unknown as Message;

  return { deleteMessage, message };
}

describe("AutomodMessageFilter", () => {
  it("deletes invite spam and records the configured warning case", async () => {
    const settings = createTestModerationService();
    const actions = createTestModerationActionService();
    await settings.setAutomodRuleAction("guild-1", "invite-links", "delete-and-warn", "admin-1");
    await settings.toggleAutomodRule("guild-1", "invite-links", "admin-1");
    const filter = new AutomodMessageFilter(
      settings,
      actions,
      new AutomodDetector(new LocalHeuristicSafetyClassifier()),
      new DiscordModerationUserNotifier(pino({ level: "silent" })),
      pino({ level: "silent" }),
    );
    const { deleteMessage, message } = createInviteMessage();

    await expect(filter.handle(message)).resolves.toBe("stop");
    expect(deleteMessage).toHaveBeenCalledOnce();
    await expect(actions.findCase("guild-1", 1)).resolves.toMatchObject({
      action: "warn",
      reason: "AutoMod: invite-links",
      status: "completed",
      targetUserId: "user-1",
    });
  });

  it("records log-only detections without deleting the message", async () => {
    const settings = createTestModerationService();
    const actions = createTestModerationActionService();
    await settings.setAutomodRuleAction("guild-1", "invite-links", "log-only", "admin-1");
    await settings.toggleAutomodRule("guild-1", "invite-links", "admin-1");
    const filter = new AutomodMessageFilter(
      settings,
      actions,
      new AutomodDetector(new LocalHeuristicSafetyClassifier()),
      new DiscordModerationUserNotifier(pino({ level: "silent" })),
      pino({ level: "silent" }),
    );
    const { deleteMessage, message } = createInviteMessage();

    await expect(filter.handle(message)).resolves.toBe("continue");
    expect(deleteMessage).not.toHaveBeenCalled();
    await expect(actions.findCase("guild-1", 1)).resolves.toMatchObject({
      action: "automod",
      status: "completed",
    });
  });

  it("skips configured channel exceptions before running a detector", async () => {
    const settings = createTestModerationService();
    const actions = createTestModerationActionService();
    await settings.setAutomodRuleAction("guild-1", "invite-links", "delete", "admin-1");
    await settings.toggleAutomodRule("guild-1", "invite-links", "admin-1");
    await settings.toggleExemptChannel("guild-1", "channel-1", "admin-1");
    const filter = new AutomodMessageFilter(
      settings,
      actions,
      new AutomodDetector(new LocalHeuristicSafetyClassifier()),
      new DiscordModerationUserNotifier(pino({ level: "silent" })),
      pino({ level: "silent" }),
    );
    const { deleteMessage, message } = createInviteMessage();

    await expect(filter.handle(message)).resolves.toBe("continue");
    expect(deleteMessage).not.toHaveBeenCalled();
    await expect(actions.findCase("guild-1", 1)).resolves.toBeUndefined();
  });
});
