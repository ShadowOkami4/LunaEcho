import { maximumLevelRewards } from "@lunaecho/modules";

import { requireManageableGuild } from "@/lib/access";
import { channelTypes, fetchGuildChannels, fetchGuildRoles } from "@/lib/discord";
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
import { removeLevelReward, saveLevelReward, saveLevelSettings } from "./actions";

export const dynamic = "force-dynamic";

export default async function LevelsPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ guildId: string }>;
  searchParams: Promise<{ notice?: string }>;
}>) {
  const { guildId } = await params;
  await requireManageableGuild(guildId);
  const app = await services();
  app.levels.invalidate(guildId);
  const [settings, rewards, leaderboard, members, channels, roles] = await Promise.all([
    app.levels.getSettings(guildId),
    app.levels.listRewards(guildId),
    app.levels.leaderboard(guildId, 10),
    app.levels.countMembers(guildId),
    fetchGuildChannels(guildId),
    fetchGuildRoles(guildId),
  ]);
  const textChannels = channels.filter((channel) => channel.type === channelTypes.text);
  const chatChannels = channels.filter(
    (channel) => channel.type === channelTypes.text || channel.type === channelTypes.voice,
  );
  const roleName = new Map(roles.map((role) => [role.id, role.name]));

  return (
    <div className="flex flex-col gap-4">
      <Notice code={(await searchParams).notice} />

      <Card
        title="Levels"
        description="Members earn XP for chatting and for time in voice. /rank shows their card and the leaderboard."
      >
        <form action={saveLevelSettings} className="grid gap-3 sm:grid-cols-2">
          <HiddenGuild guildId={guildId} />
          <Field label="XP per message (minimum)">
            <input
              name="messageXpMin"
              type="number"
              min={0}
              max={1000}
              defaultValue={settings.messageXpMin}
              className={inputClass}
            />
          </Field>
          <Field label="XP per message (maximum)">
            <input
              name="messageXpMax"
              type="number"
              min={0}
              max={1000}
              defaultValue={settings.messageXpMax}
              className={inputClass}
            />
          </Field>
          <Field label="Seconds between rewarded messages">
            <input
              name="messageCooldownSeconds"
              type="number"
              min={0}
              max={3600}
              defaultValue={settings.messageCooldownSeconds}
              className={inputClass}
            />
          </Field>
          <Field
            label="Voice XP per minute"
            hint="0 turns voice XP off. Muted and lone members earn nothing."
          >
            <input
              name="voiceXpPerMinute"
              type="number"
              min={0}
              max={1000}
              defaultValue={settings.voiceXpPerMinute}
              className={inputClass}
            />
          </Field>
          <Field label="Level-up announcements">
            <select name="announceMode" defaultValue={settings.announceMode} className={inputClass}>
              <option value="current">In the channel where the member chatted</option>
              <option value="channel">In a fixed channel</option>
              <option value="off">Off</option>
            </select>
          </Field>
          <Field label="Fixed announcement channel">
            <Picker
              name="announceChannelId"
              defaultValue={settings.announceChannelId}
              none="None"
              options={textChannels}
              prefix="#"
            />
          </Field>
          <Field label="Announcement" hint="Placeholders: {user}, {username}, {level}" wide>
            <textarea
              name="announceTemplate"
              maxLength={500}
              defaultValue={settings.announceTemplate}
              className={textAreaClass}
            />
          </Field>
          <Field label="Channels without XP">
            <MultiPicker
              name="ignoredChannelIds"
              defaultValue={settings.ignoredChannelIds}
              options={chatChannels}
              prefix="#"
            />
          </Field>
          <Field label="Roles without XP">
            <MultiPicker
              name="ignoredRoleIds"
              defaultValue={settings.ignoredRoleIds}
              options={roles}
              prefix="@"
            />
          </Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" name="stackRewards" defaultChecked={settings.stackRewards} />
            Keep lower reward roles when a member reaches a higher one
          </label>
          <div className="sm:col-span-2">
            <Button>Save</Button>
          </div>
        </form>
      </Card>

      <Card
        title="Role rewards"
        description={`Members get these roles when they reach the level. ${rewards.length}/${maximumLevelRewards} rewards.`}
      >
        {rewards.length > 0 && (
          <ul className="divide-y divide-outline">
            {rewards.map((reward) => (
              <li key={reward.level} className="flex items-center justify-between gap-4 py-2">
                <span>
                  Level {reward.level} → @{roleName.get(reward.roleId) ?? "deleted role"}
                </span>
                <form action={removeLevelReward}>
                  <HiddenGuild guildId={guildId} />
                  <input type="hidden" name="level" value={reward.level} />
                  <Button tone="danger">Remove</Button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <form action={saveLevelReward} className="grid gap-3 sm:grid-cols-3">
          <HiddenGuild guildId={guildId} />
          <Field label="Level">
            <input name="level" type="number" min={1} max={1000} required className={inputClass} />
          </Field>
          <Field label="Role">
            <Picker name="roleId" defaultValue={null} options={roles} prefix="@" />
          </Field>
          <div className="flex items-end">
            <Button>Add reward</Button>
          </div>
        </form>
      </Card>

      <Card title="Leaderboard" description={`${members.toLocaleString("en-US")} members have XP.`}>
        {leaderboard.length === 0 ? (
          <p className="text-sm text-muted">Nobody has earned XP yet.</p>
        ) : (
          <ol className="flex flex-col gap-1 text-sm">
            {leaderboard.map((entry) => (
              <li key={entry.userId} className="flex justify-between">
                <span>
                  #{entry.position} · <code>{entry.userId}</code>
                </span>
                <span className="text-muted">
                  Level {entry.level} · {entry.totalXp.toLocaleString("en-US")} XP
                </span>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
