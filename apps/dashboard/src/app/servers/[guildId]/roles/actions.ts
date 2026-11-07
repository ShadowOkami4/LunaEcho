"use server";

import { RoleMenuInputError, type RoleMenuOption } from "@lunaecho/modules";
import { z } from "zod";

import { channelTypes } from "@/lib/discord";

import { SettingsForm } from "../form";

const page = "/roles";

/** Saves a menu and posts it, replacing the earlier message. */
export async function saveRoleMenu(formData: FormData): Promise<void> {
  const form = await SettingsForm.open(formData, page);
  const menuId = form.optionalText("menuId") ?? undefined;
  form.app.roleMenus.invalidate(form.guildId);
  const previous =
    menuId === undefined ? undefined : await form.app.roleMenus.get(form.guildId, menuId);
  const roleNames = new Map((await form.discord.roles()).map((role) => [role.id, role.name]));
  const options: RoleMenuOption[] = (await form.roles("roleIds")).map((roleId) => ({
    description: form.optionalText(`description-${roleId}`),
    emoji: form.optionalText(`emoji-${roleId}`),
    label: form.optionalText(`label-${roleId}`) ?? roleNames.get(roleId) ?? "Role",
    roleId,
  }));
  const channelId = await form.requiredChannel("channelId", [channelTypes.text]);
  let savedId = "";

  await form.attempt(async () => {
    const saved = await form.app.roleMenus.save(
      {
        channelId,
        description: form.text("description"),
        guildId: form.guildId,
        mode: z.enum(["multiple", "single"]).parse(formData.get("mode")),
        options,
        style: z.enum(["buttons", "select"]).parse(formData.get("style")),
        title: form.text("title"),
        ...(menuId === undefined ? {} : { id: menuId }),
      },
      form.actorId,
    );
    savedId = saved.id;
  }, [RoleMenuInputError]);

  // The bot only deletes the old message in the menu's current channel.
  if (previous?.messageId != null && previous.channelId !== channelId) {
    await form.queue("remove-role-menu", {
      channelId: previous.channelId,
      messageId: previous.messageId,
    });
  }

  await form.queue("post-role-menu", { menuId: savedId });
  await form.saved("roles", "posted");
}

export async function deleteRoleMenu(formData: FormData): Promise<void> {
  const form = await SettingsForm.open(formData, page);
  const removed = await form.app.roleMenus.delete(form.guildId, form.text("menuId"));

  if (removed?.messageId != null) {
    await form.queue("remove-role-menu", {
      channelId: removed.channelId,
      messageId: removed.messageId,
    });
  }

  await form.saved("roles", "removed");
}
