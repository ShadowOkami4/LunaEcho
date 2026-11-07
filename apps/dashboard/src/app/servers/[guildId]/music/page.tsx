import { maximumVolume } from "@lunaecho/modules";

import { workspaceFor } from "@/lib/workspace";

import { saveMusicSettings } from "../actions";
import { Button, Card, HiddenGuild, inputClass, Notice } from "../ui";

export const dynamic = "force-dynamic";

export default async function MusicPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ botId?: string; guildId: string }>;
  searchParams: Promise<{ notice?: string }>;
}>) {
  const { app, discord, guildId, scope } = await workspaceFor(params);
  const [settings, roles] = await Promise.all([app.musicSettings.get(guildId), discord.roles()]);

  return (
    <div className="flex flex-col gap-4">
      <Notice code={(await searchParams).notice} />
      <Card
        icon="tune"
        title="Playback"
        description="Members play music with /music play. Playback runs on the Lavalink audio node."
      >
        <form action={saveMusicSettings} className="grid gap-3 sm:grid-cols-2">
          <HiddenGuild scope={scope} />
          <label className="flex flex-col gap-1 text-sm">
            DJ role
            <select name="djRoleId" defaultValue={settings.djRoleId ?? ""} className={inputClass}>
              <option value="">None — every listener controls playback</option>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  @{role.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Default volume (%)
            <input
              name="defaultVolume"
              type="number"
              min={0}
              max={maximumVolume}
              defaultValue={settings.defaultVolume}
              className={inputClass}
            />
          </label>
          <p className="text-sm text-muted sm:col-span-2">
            With a DJ role, only members with that role or Manage Server can skip, stop, or change
            the volume. Everyone can still add songs.
          </p>
          <div className="sm:col-span-2">
            <Button>Save</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
