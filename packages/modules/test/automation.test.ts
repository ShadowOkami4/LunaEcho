import type { DatabaseConnection } from "@lunaecho/db";
import { createTestDatabase, resetTestDatabase } from "@lunaecho/db/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  AutomationInputError,
  AutomationService,
  conditionsMet,
  matchesKeyword,
  renderAutomationText,
  type AutomationRuleInput,
} from "../src/index.js";

const noConditions = { channelIds: [], excludedRoleIds: [], requiredRoleIds: [] };

describe("automation matching", () => {
  it("matches keywords as contained text or the exact message, ignoring case", () => {
    expect(
      matchesKeyword(
        { keywords: ["help"], kind: "message-keyword", match: "contains" },
        "Can someone HELP me",
      ),
    ).toBe(true);
    expect(
      matchesKeyword({ keywords: ["help"], kind: "message-keyword", match: "exact" }, "help me"),
    ).toBe(false);
    expect(
      matchesKeyword({ keywords: ["help"], kind: "message-keyword", match: "exact" }, " Help "),
    ).toBe(true);
  });

  it("checks channels and roles", () => {
    const conditions = {
      channelIds: ["general"],
      excludedRoleIds: ["muted"],
      requiredRoleIds: ["member"],
    };

    expect(conditionsMet(conditions, { channelId: "general", roleIds: new Set(["member"]) })).toBe(
      true,
    );
    expect(conditionsMet(conditions, { channelId: "offtopic", roleIds: new Set(["member"]) })).toBe(
      false,
    );
    expect(
      conditionsMet(conditions, { channelId: "general", roleIds: new Set(["member", "muted"]) }),
    ).toBe(false);
    expect(conditionsMet(noConditions, { channelId: null, roleIds: new Set() })).toBe(true);
  });

  it("renders placeholders", () => {
    expect(
      renderAutomationText("{user} in {channel} on {server} ({username})", {
        channelId: "c1",
        serverName: "Luna",
        userId: "u1",
        username: "alice",
      }),
    ).toBe("<@u1> in <#c1> on Luna (alice)");
  });
});

describe("AutomationService", () => {
  let connection: DatabaseConnection;
  let now: Date;
  let service: AutomationService;
  const keywordRule: AutomationRuleInput = {
    actions: [{ emoji: "👋", kind: "react" }],
    conditions: noConditions,
    cooldownSeconds: 30,
    enabled: true,
    guildId: "guild-1",
    name: "Wave",
    trigger: { keywords: [" Hello ", "hello", "hi"], kind: "message-keyword", match: "contains" },
  };
  const scheduledRule: AutomationRuleInput = {
    actions: [{ channelId: "general", kind: "send-message", text: "Drink water!" }],
    conditions: noConditions,
    cooldownSeconds: 0,
    enabled: true,
    guildId: "guild-1",
    name: "Reminder",
    trigger: { intervalMinutes: 60, kind: "schedule" },
  };

  beforeAll(async () => {
    connection = await createTestDatabase();
    service = new AutomationService(connection.db, () => now);
  });

  afterEach(async () => {
    await resetTestDatabase(connection.db);
  });

  afterAll(async () => {
    await connection.close();
  });

  it("stores rules with cleaned keywords and lists them by trigger", async () => {
    now = new Date("2026-01-01T00:00:00.000Z");
    await service.save(keywordRule, "admin");
    await service.save({ ...keywordRule, enabled: false, name: "Off" }, "admin");

    const rules = await service.rulesFor("guild-1", "message-keyword");

    expect(rules).toHaveLength(1);
    expect(rules[0]?.trigger.keywords).toEqual(["hello", "hi"]);
  });

  it("rejects actions that do not fit the trigger", async () => {
    await expect(
      service.save(
        { ...scheduledRule, actions: [{ channelId: null, kind: "send-message", text: "x" }] },
        "admin",
      ),
    ).rejects.toBeInstanceOf(AutomationInputError);
    await expect(
      service.save({ ...keywordRule, trigger: { kind: "member-join" } }, "admin"),
    ).rejects.toBeInstanceOf(AutomationInputError);
    await expect(
      service.save(
        { ...scheduledRule, trigger: { intervalMinutes: 5, kind: "schedule" } },
        "admin",
      ),
    ).rejects.toBeInstanceOf(AutomationInputError);
  });

  it("hands out a due scheduled rule once per interval", async () => {
    now = new Date("2026-01-01T00:00:00.000Z");
    await service.save(scheduledRule, "admin");

    await expect(service.takeDueScheduled()).resolves.toEqual([]);

    now = new Date("2026-01-01T01:00:00.000Z");
    await expect(service.takeDueScheduled()).resolves.toHaveLength(1);
    await expect(service.takeDueScheduled()).resolves.toEqual([]);

    now = new Date("2026-01-01T02:00:00.000Z");
    await expect(service.takeDueScheduled()).resolves.toHaveLength(1);
  });
});
