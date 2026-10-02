import { maximumRoleMenuOptions, maximumRoleMenusPerGuild, type RoleMenu } from "@lunaecho/modules";

import { requireManageableGuild } from "@/lib/access";
import {
  channelTypes,
  fetchGuildChannels,
  fetchGuildRoles,
  type DiscordChannel,
  type DiscordRole,
} from "@/lib/discord";
import { services } from "@/lib/services";

import {
  Button,
  Card,
  Field,
  HiddenGuild,
  inputClass,
  MultiPicker,
  Notice,
  Picker,
  textAreaClass,
} from "../ui";
import { deleteRoleMenu, saveRoleMenu } from "./actions";

export const dynamic = "force-dynamic";

function MenuForm({
  channels,
  guildId,
  menu,
  roles,
}: Readonly<{
  channels: readonly DiscordChannel[];
  guildId: string;
  menu: RoleMenu | undefined;
  roles: readonly DiscordRole[];
}>) {
  const roleName = new Map(roles.map((role) => [role.id, role.name]));

  return (
    <form action={saveRoleMenu} className="grid gap-3 sm:grid-cols-2">
      <HiddenGuild guildId={guildId} />
      {menu !== undefined && <input type="hidden" name="menuId" value={menu.id} />}
      <Field label="Title">
        <input
          name="title"
          maxLength={100}
          required
          defaultValue={menu?.title ?? "Pick your roles"}
          className={inputClass}
        />
      </Field>
      <Field label="Channel">
        <Picker
          name="channelId"
          defaultValue={menu?.channelId ?? null}
          options={channels}
          prefix="#"
        />
      </Field>
      <Field label="Text" wide>
        <textarea
          name="description"
          maxLength={1000}
          defaultValue={menu?.description ?? ""}
          className={textAreaClass}
        />
      </Field>
      <Field label="Look">
        <select name="style" defaultValue={menu?.style ?? "buttons"} className={inputClass}>
          <option value="buttons">Buttons</option>
          <option value="select">Drop-down menu</option>
        </select>
      </Field>
      <Field label="Choice">
        <select name="mode" defaultValue={menu?.mode ?? "multiple"} className={inputClass}>
          <option value="multiple">Members may pick several roles</option>
          <option value="single">Members may pick one role (picking another swaps it)</option>
        </select>
      </Field>
      <Field
        label="Roles"
        hint={`Up to ${maximumRoleMenuOptions}. LunaEcho's own role must be above them.`}
        wide
      >
        <MultiPicker
          name="roleIds"
          defaultValue={menu?.options.map((option) => option.roleId) ?? []}
          options={roles}
          prefix="@"
        />
      </Field>
      {menu !== undefined && menu.options.length > 0 && (
        <div className="flex flex-col gap-2 sm:col-span-2">
          <p className="text-sm">Labels and emojis</p>
          {menu.options.map((option) => (
            <div key={option.roleId} className="grid gap-2 sm:grid-cols-[1fr_6rem_2fr]">
              <input
                name={`label-${option.roleId}`}
                maxLength={80}
                defaultValue={option.label}
                aria-label={`Label for @${roleName.get(option.roleId) ?? option.roleId}`}
                className={inputClass}
              />
              <input
                name={`emoji-${option.roleId}`}
                defaultValue={option.emoji ?? ""}
                placeholder="Emoji"
                aria-label="Emoji"
                className={inputClass}
              />
              <input
                name={`description-${option.roleId}`}
                maxLength={100}
                defaultValue={option.description ?? ""}
                placeholder="Description (drop-down only)"
                aria-label="Description"
                className={inputClass}
              />
            </div>
          ))}
          <p className="text-xs text-muted">
            New roles start with their role name as label. Emojis can be normal emojis or custom
            ones written as &lt;:name:id&gt;.
          </p>
        </div>
      )}
      <div className="sm:col-span-2">
        <Button>{menu === undefined ? "Create and post" : "Save and post again"}</Button>
      </div>
    </form>
  );
}

export default async function RolesPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ guildId: string }>;
  searchParams: Promise<{ notice?: string }>;
}>) {
  const { guildId } = await params;
  await requireManageableGuild(guildId);
  const app = await services();
  app.roleMenus.invalidate(guildId);
  const [menus, channels, roles] = await Promise.all([
    app.roleMenus.list(guildId),
    fetchGuildChannels(guildId),
    fetchGuildRoles(guildId),
  ]);
  const textChannels = channels.filter((channel) => channel.type === channelTypes.text);
  const channelName = new Map(channels.map((channel) => [channel.id, channel.name]));

  return (
    <div className="flex flex-col gap-4">
      <Notice code={(await searchParams).notice} />

      {menus.map((menu) => (
        <Card
          key={menu.id}
          title={menu.title}
          description={`#${channelName.get(menu.channelId) ?? "deleted channel"} · ${menu.options.length} roles · ${menu.messageId === null ? "not posted yet" : "posted"}`}
        >
          <MenuForm channels={textChannels} guildId={guildId} menu={menu} roles={roles} />
          <form action={deleteRoleMenu}>
            <HiddenGuild guildId={guildId} />
            <input type="hidden" name="menuId" value={menu.id} />
            <Button tone="danger">Delete menu</Button>
          </form>
        </Card>
      ))}

      {menus.length < maximumRoleMenusPerGuild && (
        <Card
          title="New role menu"
          description={`Members pick roles themselves with buttons or a drop-down. ${menus.length}/${maximumRoleMenusPerGuild} menus.`}
        >
          <MenuForm channels={textChannels} guildId={guildId} menu={undefined} roles={roles} />
        </Card>
      )}
    </div>
  );
}
