import { describe, expect, it } from "vitest";

import { canManage, permissions } from "../src/lib/permissions";

describe("canManage", () => {
  it("allows owners, administrators, and members with Manage Server", () => {
    expect(canManage({ owner: true, permissions: "0" })).toBe(true);
    expect(canManage({ owner: false, permissions: permissions.administrator.toString() })).toBe(
      true,
    );
    expect(canManage({ owner: false, permissions: permissions.manageGuild.toString() })).toBe(true);
  });

  it("refuses everyone else, including moderators", () => {
    const moderator = permissions.kickMembers | permissions.banMembers | permissions.manageMessages;

    expect(canManage({ owner: false, permissions: "0" })).toBe(false);
    expect(canManage({ owner: false, permissions: moderator.toString() })).toBe(false);
  });

  it("reads permission values above 2^53 exactly", () => {
    const large = (permissions.moderateMembers | (1n << 50n)).toString();

    expect(canManage({ owner: false, permissions: large })).toBe(false);
    expect(
      canManage({
        owner: false,
        permissions: (BigInt(large) | permissions.manageGuild).toString(),
      }),
    ).toBe(true);
  });
});
