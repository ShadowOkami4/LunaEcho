import type { Message } from "discord.js";
import { describe, expect, it, vi } from "vitest";

import type { MessageCreateHandler } from "../../src/infrastructure/discord/discord-event-handler.js";
import { ModuleGatedMessageHandler } from "../../src/infrastructure/discord/module-gated-message-handler.js";
import { createTestModuleService } from "../helpers/create-test-module-service.js";

function createMessage(guildId: string | null): Message {
  return { guildId } as unknown as Message;
}

describe("ModuleGatedMessageHandler", () => {
  it("runs the handler while the module is enabled", async () => {
    const handle = vi.fn<MessageCreateHandler["handle"]>().mockResolvedValue("stop");
    const handler = new ModuleGatedMessageHandler("moderation", createTestModuleService(), {
      handle,
    });

    await expect(handler.handle(createMessage("guild-1"))).resolves.toBe("stop");
    expect(handle).toHaveBeenCalledOnce();
  });

  it("skips the handler in guilds that disabled the module", async () => {
    const modules = createTestModuleService();
    await modules.setEnabled("guild-1", "moderation", false, "admin-1");
    const handle = vi.fn<MessageCreateHandler["handle"]>().mockResolvedValue("stop");
    const handler = new ModuleGatedMessageHandler("moderation", modules, { handle });

    await expect(handler.handle(createMessage("guild-1"))).resolves.toBe("continue");
    expect(handle).not.toHaveBeenCalled();

    await expect(handler.handle(createMessage("guild-2"))).resolves.toBe("stop");
    expect(handle).toHaveBeenCalledOnce();
  });
});
