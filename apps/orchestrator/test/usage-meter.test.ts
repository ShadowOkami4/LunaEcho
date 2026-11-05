import { randomBytes } from "node:crypto";

import { createLogger } from "@lunaecho/core";
import type { DatabaseConnection } from "@lunaecho/db";
import { createTestDatabase } from "@lunaecho/db/testing";
import { CustomBotService, TokenVault, utcDay } from "@lunaecho/modules";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { countGuilds, UsageMeter } from "../src/usage-meter.js";

const token = "MTIzNDU2Nzg5MDEyMzQ1Njc4.Gabcde.not-a-real-token-but-shaped-like-one";

/** A Discord stand-in: 250 servers of 10 members each, served in pages of 200. */
const discord = (() => {
  const guilds = Array.from({ length: 250 }, (_, index) => ({
    approximate_member_count: 10,
    id: String(1000 + index),
  }));
  return ((url: string) => {
    const after = Number(new URL(url).searchParams.get("after"));
    const page = guilds.filter((guild) => Number(guild.id) > after).slice(0, 200);
    return Promise.resolve(new Response(JSON.stringify(page)));
  }) as typeof fetch;
})();

describe("usage meter", () => {
  let connection: DatabaseConnection;
  let bots: CustomBotService;
  const now = new Date("2026-11-05T09:00:00Z");

  beforeAll(async () => {
    connection = await createTestDatabase();
    bots = new CustomBotService(connection.db, new TokenVault(randomBytes(32)), () => now);
  });

  afterAll(async () => {
    await connection.close();
  });

  it("adds up members across every page of servers", async () => {
    await expect(countGuilds(token, discord)).resolves.toEqual({
      guildCount: 250,
      memberCount: 2_500,
    });
  });

  it("reads each running bot once a day", async () => {
    await bots.grant("alice", 2, "operator");
    const running = await bots.create("alice", token, {
      applicationId: "app-1",
      avatarHash: null,
      botUserId: "bot-1",
      hasMembersIntent: true,
      hasMessageContentIntent: true,
      name: "One",
    });
    await bots.reportStatus(running.id, "running");
    const meter = new UsageMeter(
      bots,
      createLogger({ logLevel: "silent", nodeEnvironment: "test", service: "test" }),
      discord,
      () => now,
      0,
    );

    await expect(meter.measureOnce()).resolves.toBe(1);
    await expect(meter.measureOnce()).resolves.toBe(0);
    await expect(bots.measuredOn(utcDay(now))).resolves.toEqual(new Set([running.id]));
    await expect(bots.sizesFor("alice")).resolves.toMatchObject({ totalAverageMembers: 84 });
  });
});
