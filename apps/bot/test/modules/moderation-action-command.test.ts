import {
  ApplicationCommandOptionType,
  InteractionContextType,
  PermissionFlagsBits,
} from "discord.js";
import { describe, expect, it } from "vitest";

import {
  moderationActionCommandData,
  parseModerationDuration,
} from "../../src/modules/moderation/presentation/moderation-action-command.js";

describe("moderate command definition", () => {
  it("is moderator-visible and exposes the complete case-based action set", () => {
    expect(moderationActionCommandData.contexts).toEqual([InteractionContextType.Guild]);
    expect(moderationActionCommandData.default_member_permissions).toBe(
      PermissionFlagsBits.ModerateMembers.toString(),
    );
    expect(
      moderationActionCommandData.options
        ?.filter((option) => option.type === ApplicationCommandOptionType.Subcommand)
        .map((option) => option.name),
    ).toEqual([
      "warn",
      "timeout",
      "untimeout",
      "kick",
      "ban",
      "unban",
      "purge",
      "case",
      "history",
      "history-id",
      "recent",
    ]);
  });

  it("accepts moderator-friendly timeout durations and enforces Discord's maximum", () => {
    expect(parseModerationDuration("30m")).toBe(1_800);
    expect(parseModerationDuration("2H")).toBe(7_200);
    expect(parseModerationDuration("7d")).toBe(604_800);
    expect(parseModerationDuration("29d")).toBeUndefined();
    expect(parseModerationDuration("two hours")).toBeUndefined();
  });

  it("keeps purge filtering optional without changing the required action fields", () => {
    const purge = moderationActionCommandData.options?.find(
      (option) =>
        option.type === ApplicationCommandOptionType.Subcommand && option.name === "purge",
    );

    expect(purge).toMatchObject({
      options: [
        { name: "amount", required: true },
        { name: "reason", required: true },
        { name: "user", required: false },
      ],
    });
  });
});
