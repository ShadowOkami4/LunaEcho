import type { RoleMenu, Ticket } from "@lunaecho/modules";
import { describe, expect, it } from "vitest";

import { createRoleMenuRows } from "../../src/modules/roles/roles-module.js";
import { formatTranscript } from "../../src/modules/tickets/ticket-transcript.js";

const menu = (style: RoleMenu["style"], roles: number): RoleMenu => ({
  channelId: "roles",
  description: "",
  guildId: "guild-1",
  id: "menu-1",
  messageId: null,
  mode: "multiple",
  options: Array.from({ length: roles }, (_, index) => ({
    description: null,
    emoji: null,
    label: `Role ${index}`,
    roleId: `role-${index}`,
  })),
  style,
  title: "Roles",
});

describe("createRoleMenuRows", () => {
  it("puts five buttons in each row", () => {
    const rows = createRoleMenuRows(menu("buttons", 12)).map((row) => row.toJSON());

    expect(rows.map((row) => row.components.length)).toEqual([5, 5, 2]);
    expect(rows[0]?.components[0]).toMatchObject({ custom_id: "roles:menu-1:role-0" });
  });

  it("uses one select menu that also allows removing every role", () => {
    const [row] = createRoleMenuRows(menu("select", 25)).map((built) => built.toJSON());

    expect(row?.components[0]).toMatchObject({
      custom_id: "roles:menu-1",
      max_values: 25,
      min_values: 0,
    });
  });
});

describe("formatTranscript", () => {
  it("writes a header and one line per message", () => {
    const ticket: Ticket = {
      claimedBy: "mod",
      closeReason: "solved",
      closedBy: "mod",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      guildId: "guild-1",
      id: 1,
      number: 7,
      openerId: "alice",
      status: "closed",
      threadId: "thread-1",
      topic: "Help",
    };

    const text = formatTranscript(ticket, "Luna", [
      {
        attachments: ["https://cdn/x.png"],
        authorName: "alice",
        bot: false,
        content: "hi",
        createdAt: new Date("2026-01-01T00:01:00.000Z"),
      },
    ]);

    expect(text).toContain("Ticket #7 · Luna");
    expect(text).toContain("Closed by mod: solved");
    expect(text).toContain("[2026-01-01T00:01:00.000Z] alice: hi\n    [file] https://cdn/x.png");
  });
});
