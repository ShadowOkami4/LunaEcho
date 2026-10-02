import type { DatabaseConnection } from "@lunaecho/db";
import { createTestDatabase, resetTestDatabase } from "@lunaecho/db/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  computeRoleChanges,
  maximumRoleMenusPerGuild,
  RoleMenuInputError,
  RoleMenuService,
  type RoleMenuInput,
} from "../src/index.js";

const option = (roleId: string) => ({ description: null, emoji: null, label: roleId, roleId });
const colors = [option("red"), option("blue"), option("green")];

describe("computeRoleChanges", () => {
  it("toggles a button role in multiple mode", () => {
    const menu = { mode: "multiple", options: colors, style: "buttons" } as const;

    expect(computeRoleChanges(menu, new Set(["red"]), ["blue"])).toEqual({
      add: ["blue"],
      remove: [],
    });
    expect(computeRoleChanges(menu, new Set(["red"]), ["red"])).toEqual({
      add: [],
      remove: ["red"],
    });
  });

  it("swaps roles in single mode", () => {
    const menu = { mode: "single", options: colors, style: "buttons" } as const;

    expect(computeRoleChanges(menu, new Set(["red", "unrelated"]), ["green"])).toEqual({
      add: ["green"],
      remove: ["red"],
    });
  });

  it("applies the complete choice of a select menu and ignores unknown roles", () => {
    const menu = { mode: "multiple", options: colors, style: "select" } as const;

    expect(computeRoleChanges(menu, new Set(["red", "blue"]), ["blue", "green", "admin"])).toEqual({
      add: ["green"],
      remove: ["red"],
    });
    expect(computeRoleChanges(menu, new Set(["red"]), [])).toEqual({ add: [], remove: ["red"] });
  });
});

describe("RoleMenuService", () => {
  let connection: DatabaseConnection;
  let service: RoleMenuService;
  const input: RoleMenuInput = {
    channelId: "roles",
    description: "Pick a color",
    guildId: "guild-1",
    mode: "single",
    options: colors,
    style: "buttons",
    title: "Colors",
  };

  beforeAll(async () => {
    connection = await createTestDatabase();
    service = new RoleMenuService(connection.db);
  });

  afterEach(async () => {
    await resetTestDatabase(connection.db);
  });

  afterAll(async () => {
    await connection.close();
  });

  it("creates, updates, posts, and deletes a menu", async () => {
    const created = await service.save(input, "admin");
    await service.setMessage("guild-1", created.id, "message-1");
    const updated = await service.save({ ...input, id: created.id, title: "Colours" }, "admin");

    expect(updated.messageId).toBe("message-1");
    await expect(service.get("guild-1", created.id)).resolves.toMatchObject({ title: "Colours" });
    await expect(service.get("guild-2", created.id)).resolves.toBeUndefined();

    await service.delete("guild-1", created.id);
    await expect(service.list("guild-1")).resolves.toEqual([]);
  });

  it("rejects duplicate roles, empty menus, and too many menus", async () => {
    await expect(
      service.save({ ...input, options: [option("red"), option("red")] }, "admin"),
    ).rejects.toBeInstanceOf(RoleMenuInputError);
    await expect(service.save({ ...input, options: [] }, "admin")).rejects.toBeInstanceOf(
      RoleMenuInputError,
    );

    for (let index = 0; index < maximumRoleMenusPerGuild; index += 1) {
      await service.save(input, "admin");
    }

    await expect(service.save(input, "admin")).rejects.toBeInstanceOf(RoleMenuInputError);
  });
});
