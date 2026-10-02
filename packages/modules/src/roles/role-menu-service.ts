import { randomUUID } from "node:crypto";

import { ExpiringCache, type Clock } from "@lunaecho/core";
import { roleMenus, type LunaDatabase } from "@lunaecho/db";
import { and, asc, count, eq } from "drizzle-orm";

export const maximumRoleMenusPerGuild = 25;
/** Discord allows 25 select options, and 5 rows of 5 buttons. */
export const maximumRoleMenuOptions = 25;

export type RoleMenuStyle = "buttons" | "select";
/** "single" behaves like radio buttons: picking one role removes the others of the menu. */
export type RoleMenuMode = "multiple" | "single";

export type RoleMenuOption = Readonly<{
  description: string | null;
  emoji: string | null;
  label: string;
  roleId: string;
}>;

export type RoleMenu = Readonly<{
  channelId: string;
  description: string;
  guildId: string;
  id: string;
  messageId: string | null;
  mode: RoleMenuMode;
  options: readonly RoleMenuOption[];
  style: RoleMenuStyle;
  title: string;
}>;

export type RoleMenuInput = Omit<RoleMenu, "id" | "messageId"> & Readonly<{ id?: string }>;

export class RoleMenuInputError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "RoleMenuInputError";
  }
}

export type RoleChanges = Readonly<{ add: readonly string[]; remove: readonly string[] }>;

/**
 * Works out which roles to give and take. For buttons, `picked` is the clicked role and toggles
 * it; for a select menu, `picked` is the complete new choice.
 */
export function computeRoleChanges(
  menu: Pick<RoleMenu, "mode" | "options" | "style">,
  heldRoleIds: ReadonlySet<string>,
  picked: readonly string[],
): RoleChanges {
  const menuRoleIds = menu.options.map((option) => option.roleId);
  const valid = picked.filter((roleId) => menuRoleIds.includes(roleId));
  let wanted: Set<string>;

  if (menu.style === "buttons") {
    const [clicked] = valid;

    if (clicked === undefined) {
      return { add: [], remove: [] };
    }

    wanted = new Set(menuRoleIds.filter((roleId) => heldRoleIds.has(roleId)));

    if (wanted.has(clicked)) {
      wanted.delete(clicked);
    } else {
      if (menu.mode === "single") {
        wanted.clear();
      }

      wanted.add(clicked);
    }
  } else {
    wanted = new Set(menu.mode === "single" ? valid.slice(0, 1) : valid);
  }

  return {
    add: menuRoleIds.filter((roleId) => wanted.has(roleId) && !heldRoleIds.has(roleId)),
    remove: menuRoleIds.filter((roleId) => !wanted.has(roleId) && heldRoleIds.has(roleId)),
  };
}

function validate(input: RoleMenuInput): RoleMenuInput {
  const title = input.title.trim();
  const description = input.description.trim();

  if (title.length === 0 || title.length > 100) {
    throw new RoleMenuInputError("The title needs 1 to 100 characters.");
  }

  if (description.length > 1_000) {
    throw new RoleMenuInputError("The text can have at most 1,000 characters.");
  }

  if (input.options.length === 0 || input.options.length > maximumRoleMenuOptions) {
    throw new RoleMenuInputError(`A menu needs 1 to ${maximumRoleMenuOptions} roles.`);
  }

  if (new Set(input.options.map((option) => option.roleId)).size !== input.options.length) {
    throw new RoleMenuInputError("Each role can appear only once in a menu.");
  }

  const options = input.options.map((option) => {
    const label = option.label.trim();
    const optionDescription = option.description?.trim() ?? "";
    const emoji = option.emoji?.trim() ?? "";

    if (label.length === 0 || label.length > 80) {
      throw new RoleMenuInputError("Every role needs a label of 1 to 80 characters.");
    }

    if (optionDescription.length > 100) {
      throw new RoleMenuInputError("Role descriptions can have at most 100 characters.");
    }

    return {
      description: optionDescription.length === 0 ? null : optionDescription,
      emoji: emoji.length === 0 ? null : emoji,
      label,
      roleId: option.roleId,
    };
  });

  return { ...input, description, options, title };
}

export class RoleMenuService {
  /** Whole menu lists per guild; a guild has at most 25 menus, so this stays small. */
  private readonly cache: ExpiringCache<string, readonly RoleMenu[]>;

  public constructor(
    private readonly database: LunaDatabase,
    private readonly clock: Clock = () => new Date(),
  ) {
    this.cache = new ExpiringCache({ clock, maximumEntries: 5_000, ttlMilliseconds: 60_000 });
  }

  public invalidate(guildId: string): void {
    this.cache.delete(guildId);
  }

  public async list(guildId: string): Promise<readonly RoleMenu[]> {
    const cached = this.cache.get(guildId);

    if (cached !== undefined) {
      return cached;
    }

    const rows = await this.database
      .select()
      .from(roleMenus)
      .where(eq(roleMenus.guildId, guildId))
      .orderBy(asc(roleMenus.title), asc(roleMenus.id));
    const menus: readonly RoleMenu[] = rows.map((row) => ({
      channelId: row.channelId,
      description: row.description,
      guildId: row.guildId,
      id: row.id,
      messageId: row.messageId,
      mode: row.mode,
      options: row.options,
      style: row.style,
      title: row.title,
    }));
    this.cache.set(guildId, menus);
    return menus;
  }

  public async get(guildId: string, menuId: string): Promise<RoleMenu | undefined> {
    return (await this.list(guildId)).find((menu) => menu.id === menuId);
  }

  /** Creates a menu without an id, or updates the menu with that id. */
  public async save(input: RoleMenuInput, actorId: string): Promise<RoleMenu> {
    const menu = validate(input);
    const values = {
      channelId: menu.channelId,
      description: menu.description,
      mode: menu.mode,
      options: menu.options.map((option) => ({ ...option })),
      style: menu.style,
      title: menu.title,
      updatedAt: this.clock(),
      updatedBy: actorId,
    };

    try {
      if (menu.id !== undefined) {
        const [row] = await this.database
          .update(roleMenus)
          .set(values)
          .where(and(eq(roleMenus.guildId, menu.guildId), eq(roleMenus.id, menu.id)))
          .returning({ messageId: roleMenus.messageId });

        if (row === undefined) {
          throw new RoleMenuInputError("This menu does not exist anymore.");
        }

        return { ...menu, id: menu.id, messageId: row.messageId };
      }

      const [existing] = await this.database
        .select({ value: count() })
        .from(roleMenus)
        .where(eq(roleMenus.guildId, menu.guildId));

      if ((existing?.value ?? 0) >= maximumRoleMenusPerGuild) {
        throw new RoleMenuInputError(
          `A server can have at most ${maximumRoleMenusPerGuild} menus.`,
        );
      }

      const id = randomUUID();
      await this.database.insert(roleMenus).values({ ...values, guildId: menu.guildId, id });
      return { ...menu, id, messageId: null };
    } finally {
      this.cache.delete(menu.guildId);
    }
  }

  public async delete(guildId: string, menuId: string): Promise<RoleMenu | undefined> {
    const menu = await this.get(guildId, menuId);
    await this.database
      .delete(roleMenus)
      .where(and(eq(roleMenus.guildId, guildId), eq(roleMenus.id, menuId)));
    this.cache.delete(guildId);
    return menu;
  }

  public async setMessage(
    guildId: string,
    menuId: string,
    messageId: string | null,
  ): Promise<void> {
    await this.database
      .update(roleMenus)
      .set({ messageId })
      .where(and(eq(roleMenus.guildId, guildId), eq(roleMenus.id, menuId)));
    this.cache.delete(guildId);
  }
}
