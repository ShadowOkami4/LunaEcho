import type { User } from "discord.js";
import pino from "pino";
import { describe, expect, it, vi } from "vitest";

import type { ModerationCase } from "@lunaecho/modules";
import { DiscordModerationUserNotifier } from "../../src/modules/moderation/infrastructure/discord-moderation-user-notifier.js";

const moderationCase: ModerationCase = {
  action: "warn",
  caseNumber: 12,
  completedAt: new Date("2026-01-01T00:00:01.000Z"),
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  durationSeconds: null,
  failureCode: null,
  guildId: "guild-1",
  moderatorUserId: "admin-1",
  reason: "Repeated spam",
  status: "completed",
  targetUserId: "user-1",
};

describe("DiscordModerationUserNotifier", () => {
  it("uses a Components V2 DM and treats closed DMs as non-fatal", async () => {
    const notifier = new DiscordModerationUserNotifier(pino({ level: "silent" }));
    const send = vi
      .fn<(options: unknown) => Promise<unknown>>()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("DM closed"));
    const user = { id: "user-1", send } as unknown as User;

    await expect(notifier.notify(user, "Test Guild", moderationCase, true)).resolves.toBe("sent");
    expect(send).toHaveBeenCalledOnce();
    const payload = send.mock.calls[0]?.[0];
    expect(payload).toBeTypeOf("object");

    if (payload === null || typeof payload !== "object") {
      throw new TypeError("Expected a Discord message payload");
    }

    expect("components" in payload).toBe(true);
    await expect(notifier.notify(user, "Test Guild", moderationCase, true)).resolves.toBe(
      "unavailable",
    );
  });

  it("does not contact the member when notifications are disabled", async () => {
    const notifier = new DiscordModerationUserNotifier(pino({ level: "silent" }));
    const send = vi.fn();
    const user = { id: "user-1", send } as unknown as User;

    await expect(notifier.notify(user, "Test Guild", moderationCase, false)).resolves.toBe(
      "disabled",
    );
    expect(send).not.toHaveBeenCalled();
  });
});
