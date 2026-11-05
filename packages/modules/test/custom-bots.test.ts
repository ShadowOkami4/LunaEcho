import { randomBytes } from "node:crypto";

import { customBots, type DatabaseConnection } from "@lunaecho/db";
import { createTestDatabase, resetTestDatabase } from "@lunaecho/db/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  BotTokenError,
  CustomBotError,
  CustomBotService,
  inspectBotToken,
  TokenVault,
  utcDay,
  type BotTokenInspection,
} from "../src/index.js";

const token = "MTIzNDU2Nzg5MDEyMzQ1Njc4.Gabcde.not-a-real-token-but-shaped-like-one";
const inspection = (applicationId: string): BotTokenInspection => ({
  applicationId,
  avatarHash: null,
  botUserId: `bot-${applicationId}`,
  hasMembersIntent: true,
  hasMessageContentIntent: true,
  name: `Bot ${applicationId}`,
});

describe("CustomBotService", () => {
  let connection: DatabaseConnection;
  let service: CustomBotService;

  beforeAll(async () => {
    connection = await createTestDatabase();
    service = new CustomBotService(connection.db, new TokenVault(randomBytes(32)));
  });

  afterEach(async () => {
    await resetTestDatabase(connection.db);
  });

  afterAll(async () => {
    await connection.close();
  });

  it("needs a granted slot, and stores the token only sealed", async () => {
    await expect(service.create("alice", token, inspection("app-1"))).rejects.toMatchObject({
      reason: "no-slot",
    });

    await service.grant("alice", 1, "operator");
    const bot = await service.create("alice", token, inspection("app-1"));
    const [stored] = await connection.db.select().from(customBots);

    expect(bot).toMatchObject({ desiredState: "running", status: "pending" });
    expect(stored?.sealedToken).not.toContain(token);
    expect(stored?.databaseName).toMatch(/^lunaecho_custom_[0-9a-f]{16}$/);

    const [deployment] = await service.listDeployments();
    expect(deployment === undefined ? undefined : service.openToken(deployment)).toBe(token);
  });

  it("keeps slots exact under concurrent submissions and refuses a known application", async () => {
    await service.grant("alice", 2, "operator");

    const results = await Promise.allSettled(
      ["a", "b", "c", "d"].map((app) => service.create("alice", token, inspection(app))),
    );

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(2);
    await service.grant("bob", 1, "operator");
    await expect(service.create("bob", token, inspection("a"))).rejects.toMatchObject({
      reason: "already-registered",
    });
  });

  it("shows owners only their own bots", async () => {
    await service.grant("alice", 1, "operator");
    const bot = await service.create("alice", token, inspection("app-1"));

    await expect(service.listOwned("bob")).resolves.toEqual([]);
    await expect(service.getOwned("bob", bot.id)).rejects.toBeInstanceOf(CustomBotError);
    await expect(service.setDesiredState("bob", bot.id, "stopped")).rejects.toBeInstanceOf(
      CustomBotError,
    );
  });

  it("replaces tokens only for the same application, and frees the slot after deletion", async () => {
    await service.grant("alice", 1, "operator");
    const bot = await service.create("alice", token, inspection("app-1"));

    await expect(
      service.replaceToken("alice", bot.id, token, inspection("app-2")),
    ).rejects.toMatchObject({ reason: "different-application" });

    await service.setDesiredState("alice", bot.id, "deleted");
    await expect(service.listOwned("alice")).resolves.toEqual([]);
    await service.forget(bot.id);
    await expect(service.create("alice", token, inspection("app-1"))).resolves.toBeDefined();
  });

  it("lists grants with their use", async () => {
    await service.grant("alice", 2, "operator", "beta tester");
    await service.create("alice", token, inspection("app-1"));

    await expect(service.listGrants()).resolves.toEqual([
      { note: "beta tester", partner: false, slots: 2, used: 1, userId: "alice" },
    ]);
  });

  it("stops the newest bots when slots shrink, and starts them only into a free slot", async () => {
    await service.grant("alice", 2, "billing");
    const older = await service.create("alice", token, inspection("app-1"));
    const newer = await service.create("alice", token, inspection("app-2"));

    await service.grant("alice", 1, "billing");
    await expect(service.getOwned("alice", older.id)).resolves.toMatchObject({
      desiredState: "running",
    });
    await expect(service.getOwned("alice", newer.id)).resolves.toMatchObject({
      desiredState: "stopped",
    });
    await expect(service.setDesiredState("alice", newer.id, "running")).rejects.toMatchObject({
      reason: "no-slot",
    });

    await service.grant("alice", 2, "billing");
    await service.setDesiredState("alice", newer.id, "running");
    await expect(service.getOwned("alice", newer.id)).resolves.toMatchObject({
      desiredState: "running",
    });
  });

  it("averages a bot's members over 30 days, counting days without a reading as zero", async () => {
    const now = new Date("2026-11-30T12:00:00Z");
    const clocked = new CustomBotService(connection.db, new TokenVault(randomBytes(32)), () => now);
    const reading = (botId: string, offset: number, memberCount: number) =>
      clocked.recordUsage({
        botId,
        day: utcDay(now, -offset),
        guildCount: 2,
        memberCount,
        ownerUserId: "alice",
      });

    // Half the month at 2,000 members, a raid day at 50,000, and one reading outside the window.
    for (let offset = 0; offset < 15; offset += 1) {
      await reading("bot-a", offset, 2_000);
    }
    await reading("bot-b", 3, 50_000);
    await reading("bot-b", 30, 90_000);
    await reading("bot-a", 0, 2_100);

    const sizes = await clocked.sizesFor("alice");

    expect(sizes.bots.get("bot-a")).toEqual({
      averageMembers: 1_004,
      latestGuilds: 2,
      latestMembers: 2_100,
    });
    expect(sizes.bots.get("bot-b")?.averageMembers).toBe(1_667);
    expect(sizes.totalAverageMembers).toBe(2_670);
    await expect(clocked.measuredOn(utcDay(now))).resolves.toEqual(new Set(["bot-a"]));
  });

  it("reports a user's grant with its Partner flag and the slots in use", async () => {
    await expect(service.grantFor("alice")).resolves.toEqual({ partner: false, slots: 0, used: 0 });

    await service.grant("alice", 2, "operator", "own server", true);
    await service.create("alice", token, inspection("app-1"));

    await expect(service.grantFor("alice")).resolves.toEqual({ partner: true, slots: 2, used: 1 });
  });
});

describe("inspectBotToken", () => {
  const reply = (status: number, body: unknown) =>
    (() => Promise.resolve(new Response(JSON.stringify(body), { status }))) as typeof fetch;

  it("reads the application, bot user, and intents", async () => {
    await expect(
      inspectBotToken(
        token,
        reply(200, {
          bot: { avatar: "abc", id: "999", username: "Kitty" },
          flags: 1 << 15,
          id: "123",
        }),
      ),
    ).resolves.toEqual({
      applicationId: "123",
      avatarHash: "abc",
      botUserId: "999",
      hasMembersIntent: true,
      hasMessageContentIntent: false,
      name: "Kitty",
    });
  });

  it("refuses malformed and rejected tokens without calling Discord for the first", async () => {
    let calls = 0;
    const counting = (() => {
      calls += 1;
      return Promise.resolve(new Response("{}", { status: 401 }));
    }) as typeof fetch;

    await expect(inspectBotToken("hello", counting)).rejects.toBeInstanceOf(BotTokenError);
    expect(calls).toBe(0);
    await expect(inspectBotToken(token, counting)).rejects.toThrow("does not accept");
  });
});
