import type { Message } from "discord.js";
import { describe, expect, it } from "vitest";

import { AutomodDetector } from "../../src/modules/moderation/domain/automod-detector.js";
import { createDefaultAutomodRules, type AutomodRuleKind } from "@lunaecho/modules";
import { LocalHeuristicSafetyClassifier } from "../../src/modules/moderation/infrastructure/local-heuristic-safety-classifier.js";

function createMessage(
  content: string,
  overrides: Readonly<{
    attachments?: number;
    channelId?: string;
    everyone?: boolean;
    poll?: boolean;
    roleMentions?: number;
    userMentions?: number;
  }> = {},
): Message<true> {
  return {
    attachments: new Map(
      Array.from({ length: overrides.attachments ?? 0 }, (_, index) => [`a${index}`, {}]),
    ),
    author: { id: "user-1" },
    channelId: overrides.channelId ?? "channel-1",
    content,
    guildId: "guild-1",
    mentions: {
      everyone: overrides.everyone ?? false,
      roles: new Map(
        Array.from({ length: overrides.roleMentions ?? 0 }, (_, index) => [`r${index}`, {}]),
      ),
      users: new Map(
        Array.from({ length: overrides.userMentions ?? 0 }, (_, index) => [`u${index}`, {}]),
      ),
    },
    poll: overrides.poll === true ? {} : null,
  } as unknown as Message<true>;
}

function enable(...kinds: readonly AutomodRuleKind[]) {
  return createDefaultAutomodRules().map((rule) => ({
    ...rule,
    enabled: kinds.includes(rule.kind),
  }));
}

describe("AutomodDetector", () => {
  it("detects invite, mention, attachment, large-message, and poll rules", async () => {
    const classifier = new LocalHeuristicSafetyClassifier();

    await expect(
      new AutomodDetector(classifier).detect(
        createMessage("Join https://discord.gg/example"),
        enable("invite-links"),
      ),
    ).resolves.toMatchObject({ kind: "invite-links" });
    await expect(
      new AutomodDetector(classifier).detect(
        createMessage("hello", { userMentions: 5 }),
        enable("mention-spam"),
      ),
    ).resolves.toMatchObject({ kind: "mention-spam" });
    await expect(
      new AutomodDetector(classifier).detect(
        createMessage("files", { attachments: 4 }),
        enable("attachment-spam"),
      ),
    ).resolves.toMatchObject({ kind: "attachment-spam" });
    await expect(
      new AutomodDetector(classifier).detect(
        createMessage("x".repeat(1_500)),
        enable("large-message"),
      ),
    ).resolves.toMatchObject({ kind: "large-message" });
    await expect(
      new AutomodDetector(classifier).detect(
        createMessage("vote", { poll: true }),
        enable("polls"),
      ),
    ).resolves.toMatchObject({ kind: "polls" });
  });

  it("detects same-channel floods and cross-channel spam within their windows", async () => {
    let now = 1_000;
    const detector = new AutomodDetector(new LocalHeuristicSafetyClassifier(), () => now);

    for (let index = 0; index < 4; index += 1) {
      await expect(
        detector.detect(createMessage(`message ${index}`), enable("message-flood")),
      ).resolves.toBeUndefined();
      now += 1_000;
    }

    await expect(
      detector.detect(createMessage("message 5"), enable("message-flood")),
    ).resolves.toMatchObject({ kind: "message-flood" });

    now += 20_000;
    const crossChannelDetector = new AutomodDetector(
      new LocalHeuristicSafetyClassifier(),
      () => now,
    );
    const channels = ["channel-1", "channel-2", "channel-3", "channel-1"];

    for (const [index, channelId] of channels.entries()) {
      const result = await crossChannelDetector.detect(
        createMessage(`cross ${index}`, { channelId }),
        enable("cross-channel-spam"),
      );

      if (index < 3) {
        expect(result).toBeUndefined();
      } else {
        expect(result).toMatchObject({ kind: "cross-channel-spam" });
      }

      now += 1_000;
    }
  });

  it("uses a rule's custom trigger threshold", async () => {
    let now = 1_000;
    const detector = new AutomodDetector(new LocalHeuristicSafetyClassifier(), () => now);
    const rules = enable("message-flood").map((rule) =>
      rule.kind === "message-flood"
        ? { ...rule, threshold: { ...rule.threshold, triggerLimit: 3, windowSeconds: 5 } }
        : rule,
    );

    await expect(detector.detect(createMessage("one"), rules)).resolves.toBeUndefined();
    now += 1_000;
    await expect(detector.detect(createMessage("two"), rules)).resolves.toBeUndefined();
    now += 1_000;
    await expect(detector.detect(createMessage("three"), rules)).resolves.toMatchObject({
      kind: "message-flood",
    });
  });
});
