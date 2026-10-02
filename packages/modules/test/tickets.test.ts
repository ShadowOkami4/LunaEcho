import type { DatabaseConnection } from "@lunaecho/db";
import { createTestDatabase, resetTestDatabase } from "@lunaecho/db/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { TicketService, TicketSettingsInputError } from "../src/index.js";

describe("TicketService", () => {
  let connection: DatabaseConnection;
  let service: TicketService;

  beforeAll(async () => {
    connection = await createTestDatabase();
    service = new TicketService(connection.db);
  });

  afterEach(async () => {
    await resetTestDatabase(connection.db);
  });

  afterAll(async () => {
    await connection.close();
  });

  async function configure(maximumOpenPerMember = 1): Promise<void> {
    await service.saveSettings(
      {
        ...(await service.getSettings("guild-1")),
        maximumOpenPerMember,
        panelChannelId: "support",
      },
      "admin",
    );
  }

  it("needs a panel channel before tickets can open", async () => {
    await expect(
      service.open({ guildId: "guild-1", openerId: "alice", topic: "Help" }),
    ).resolves.toEqual({ kind: "not-configured" });
  });

  it("numbers tickets per guild and enforces the per-member limit", async () => {
    await configure();

    const first = await service.open({ guildId: "guild-1", openerId: "alice", topic: "Help" });
    const second = await service.open({ guildId: "guild-1", openerId: "bob", topic: "Bug" });
    const blocked = await service.open({ guildId: "guild-1", openerId: "alice", topic: "Again" });

    expect(first).toMatchObject({ kind: "opened", ticket: { number: 1 } });
    expect(second).toMatchObject({ kind: "opened", ticket: { number: 2 } });
    expect(blocked).toMatchObject({ kind: "too-many" });
  });

  it("keeps the limit and numbering exact under concurrent opens", async () => {
    await configure(2);

    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        service.open({ guildId: "guild-1", openerId: "alice", topic: "Spam" }),
      ),
    );

    expect(results.filter((result) => result.kind === "opened")).toHaveLength(2);
    await expect(service.countOpen("guild-1")).resolves.toBe(2);
  });

  it("claims once, closes once, and frees the member's slot", async () => {
    await configure();
    const opened = await service.open({ guildId: "guild-1", openerId: "alice", topic: "Help" });

    if (opened.kind !== "opened") {
      throw new Error("expected a ticket");
    }

    await service.attachThread(opened.ticket.id, "thread-1");
    await expect(service.claim(opened.ticket.id, "mod-1")).resolves.toBe(true);
    await expect(service.claim(opened.ticket.id, "mod-2")).resolves.toBe(false);
    await expect(service.findByThread("thread-1")).resolves.toMatchObject({ claimedBy: "mod-1" });

    await expect(service.close(opened.ticket.id, "mod-1", " solved ")).resolves.toMatchObject({
      closeReason: "solved",
      status: "closed",
    });
    await expect(service.close(opened.ticket.id, "mod-1", null)).resolves.toBeUndefined();
    await expect(
      service.open({ guildId: "guild-1", openerId: "alice", topic: "New" }),
    ).resolves.toMatchObject({ kind: "opened", ticket: { number: 2 } });
  });

  it("validates the settings", async () => {
    const settings = await service.getSettings("guild-1");

    await expect(
      service.saveSettings({ ...settings, maximumOpenPerMember: 0 }, "admin"),
    ).rejects.toBeInstanceOf(TicketSettingsInputError);
    await expect(
      service.saveSettings(
        { ...settings, staffRoleIds: Array.from({ length: 11 }, (_, index) => `role-${index}`) },
        "admin",
      ),
    ).rejects.toBeInstanceOf(TicketSettingsInputError);
  });
});
