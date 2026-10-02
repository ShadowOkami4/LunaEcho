import type { DatabaseConnection } from "@lunaecho/db";
import { createTestDatabase, resetTestDatabase } from "@lunaecho/db/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  maximumAutoroles,
  renderWelcomeTemplate,
  WelcomeSettingsInputError,
  WelcomeSettingsService,
} from "../src/index.js";

describe("renderWelcomeTemplate", () => {
  it("fills every placeholder, also when it appears twice", () => {
    expect(
      renderWelcomeTemplate(
        "Hi {user} ({username})! {server} has {memberCount} members, {username}.",
        {
          memberCount: 1234,
          serverName: "Luna",
          userId: "42",
          username: "alice",
        },
      ),
    ).toBe("Hi <@42> (alice)! Luna has 1,234 members, alice.");
  });
});

describe("WelcomeSettingsService", () => {
  let connection: DatabaseConnection;
  let service: WelcomeSettingsService;

  beforeAll(async () => {
    connection = await createTestDatabase();
    service = new WelcomeSettingsService(connection.db);
  });

  afterEach(async () => {
    await resetTestDatabase(connection.db);
  });

  afterAll(async () => {
    await connection.close();
  });

  it("does nothing until it is configured", async () => {
    await expect(service.get("guild-1")).resolves.toMatchObject({
      autoroleIds: [],
      welcomeChannelId: null,
      welcomeMessage: null,
    });
  });

  it("stores settings, treats blank texts as off, and deduplicates autoroles", async () => {
    await service.save(
      {
        ...(await service.get("guild-1")),
        autoroleIds: ["member", "member", "news"],
        goodbyeMessage: "   ",
        welcomeChannelId: "welcome",
        welcomeMessage: "  Hi {user}  ",
      },
      "admin",
    );

    await expect(service.get("guild-1")).resolves.toMatchObject({
      autoroleIds: ["member", "news"],
      goodbyeMessage: null,
      welcomeChannelId: "welcome",
      welcomeMessage: "Hi {user}",
    });
  });

  it("keeps the rest when the verification message changes", async () => {
    await service.save(
      { ...(await service.get("guild-1")), verificationRoleId: "verified" },
      "admin",
    );
    await service.setVerificationMessage("guild-1", "message-1");

    await expect(service.get("guild-1")).resolves.toMatchObject({
      verificationMessageId: "message-1",
      verificationRoleId: "verified",
    });

    // A dashboard form loaded before the panel was posted must not forget the posted message.
    await service.save(
      { ...(await service.get("guild-1")), verificationMessageId: null, welcomeMessage: "Hi" },
      "admin",
    );
    await expect(service.get("guild-1")).resolves.toMatchObject({
      verificationMessageId: "message-1",
    });
  });

  it("rejects too many autoroles and too long messages", async () => {
    const settings = await service.get("guild-1");

    await expect(
      service.save(
        {
          ...settings,
          autoroleIds: Array.from({ length: maximumAutoroles + 1 }, (_, index) => `role-${index}`),
        },
        "admin",
      ),
    ).rejects.toBeInstanceOf(WelcomeSettingsInputError);
    await expect(
      service.save({ ...settings, welcomeMessage: "x".repeat(2_000) }, "admin"),
    ).rejects.toBeInstanceOf(WelcomeSettingsInputError);
  });
});
