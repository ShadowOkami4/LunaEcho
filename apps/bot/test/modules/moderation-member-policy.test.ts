import type { GuildMember } from "discord.js";
import { describe, expect, it } from "vitest";

import { evaluateModerationMemberTarget } from "../../src/modules/moderation/domain/moderation-member-policy.js";

function createMember(id: string, rolePosition: number, bot = false): GuildMember {
  return {
    id,
    roles: {
      highest: {
        comparePositionTo: (other: Readonly<{ position: number }>) => rolePosition - other.position,
        position: rolePosition,
      },
    },
    user: { bot },
  } as unknown as GuildMember;
}

describe("evaluateModerationMemberTarget", () => {
  it("blocks self-targets, the owner, bots, and equal or higher roles", () => {
    const moderator = createMember("moderator", 10);

    expect(evaluateModerationMemberTarget(moderator, moderator, "owner")).toBe("self-target");
    expect(evaluateModerationMemberTarget(moderator, createMember("owner", 100), "owner")).toBe(
      "guild-owner",
    );
    expect(evaluateModerationMemberTarget(moderator, createMember("bot", 1, true), "owner")).toBe(
      "bot-target",
    );
    expect(evaluateModerationMemberTarget(moderator, createMember("peer", 10), "owner")).toBe(
      "higher-or-equal-role",
    );
  });

  it("allows higher-ranked moderators and gives the owner a hierarchy bypass", () => {
    expect(
      evaluateModerationMemberTarget(
        createMember("moderator", 10),
        createMember("user", 1),
        "owner",
      ),
    ).toBeUndefined();
    expect(
      evaluateModerationMemberTarget(createMember("owner", 1), createMember("staff", 100), "owner"),
    ).toBeUndefined();
  });
});
