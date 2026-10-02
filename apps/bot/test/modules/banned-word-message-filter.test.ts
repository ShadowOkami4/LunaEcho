import type { Message } from "discord.js";
import pino from "pino";
import { describe, expect, it, vi } from "vitest";

import { BannedWordMessageFilter } from "../../src/modules/moderation/application/banned-word-message-filter.js";
import { createTestModerationService } from "../helpers/create-test-moderation-service.js";

function createMessage(content: string, authorIsBot = false) {
  const deleteMessage = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const message = {
    author: { bot: authorIsBot, id: "user-1" },
    channelId: "channel-1",
    content,
    delete: deleteMessage,
    guildId: "guild-1",
    id: "message-1",
    inGuild: () => true,
    webhookId: null,
  } as unknown as Message;

  return { deleteMessage, message };
}

describe("BannedWordMessageFilter", () => {
  it("deletes matching guild messages when enabled", async () => {
    const settings = createTestModerationService();
    await settings.addBannedWord("guild-1", "bad word", "admin-1");
    await settings.toggleBannedWords("guild-1");
    const filter = new BannedWordMessageFilter(settings, pino({ level: "silent" }));
    const { deleteMessage, message } = createMessage("This BAD WORD should be removed.");

    await filter.handle(message);
    expect(deleteMessage).toHaveBeenCalledOnce();
  });

  it("ignores safe messages and bot messages", async () => {
    const settings = createTestModerationService();
    await settings.addBannedWord("guild-1", "bad word", "admin-1");
    await settings.toggleBannedWords("guild-1");
    const filter = new BannedWordMessageFilter(settings, pino({ level: "silent" }));
    const safe = createMessage("This message is safe.");
    const bot = createMessage("This contains bad word.", true);

    await filter.handle(safe.message);
    await filter.handle(bot.message);
    expect(safe.deleteMessage).not.toHaveBeenCalled();
    expect(bot.deleteMessage).not.toHaveBeenCalled();
  });
});
