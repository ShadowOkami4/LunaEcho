import { maximumVolume } from "@lunaecho/modules";

import { requireManageableGuild } from "@/lib/access";
import { fetchGuildRoles } from "@/lib/discord";
import { services } from "@/lib/services";

import { saveMusicSettings } from "../actions";
import { Button, Card, HiddenGuild, inputClass, Notice } from "../ui";

export const dynamic = "force-dynamic";

export default async function MusicPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ guildId: string }>;
  searchParams: Promise<{ notice?: string }>;
}>) {
  const { guildId } = await params;
  await requireManageableGuild(guildId);
  const app = await services();
  const [settings, roles] = await Promise.all([
    app.musicSettings.get(guildId),
    fetchGuildRoles(guildId),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <Notice code={(await searchParams).notice} />
      <Card
        title="Music"
        description="Members play music with /music play. Playback runs on the Lavalink audio node."
      >
        <form action={saveMusicSettings} className="grid gap-3 sm:grid-cols-2">
          <HiddenGuild guildId={guildId} />
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
