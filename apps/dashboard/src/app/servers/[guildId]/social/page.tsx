import { defaultSocialMessages, maximumSocialFeedsPerGuild } from "@lunaecho/modules";

import { requireManageableGuild } from "@/lib/access";
import { channelTypes, fetchGuildChannels, fetchGuildRoles } from "@/lib/discord";
import { services } from "@/lib/services";

import { Button, Card, Field, HiddenGuild, inputClass, Notice, Picker, textAreaClass } from "../ui";
import { addSocialFeed, removeSocialFeed } from "./actions";

export const dynamic = "force-dynamic";

export default async function SocialPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ guildId: string }>;
  searchParams: Promise<{ notice?: string }>;
}>) {
  const { guildId } = await params;
  await requireManageableGuild(guildId);
  const app = await services();
  const [feeds, channels, roles] = await Promise.all([
    app.social.list(guildId),
    fetchGuildChannels(guildId),
    fetchGuildRoles(guildId),
  ]);
  const textChannels = channels.filter((channel) => channel.type === channelTypes.text);
  const channelName = new Map(channels.map((channel) => [channel.id, channel.name]));
  const roleName = new Map(roles.map((role) => [role.id, role.name]));

  return (
    <div className="flex flex-col gap-4">
      <Notice code={(await searchParams).notice} />

      <Card
        title="Social notifications"
        description={`Announce new YouTube videos and Twitch streams. YouTube is checked every 5 minutes, Twitch every 2. ${feeds.length}/${maximumSocialFeedsPerGuild} creators.`}
      >
        {feeds.length === 0 ? (
          <p className="text-sm text-muted">Not following anyone yet.</p>
        ) : (
          <ul className="divide-y divide-outline">
            {feeds.map((feed) => (
              <li key={feed.id} className="flex items-center justify-between gap-4 py-3">
                <div>
                  <p className="font-medium">
                    {feed.platform === "youtube" ? "📺" : "🔴"} {feed.displayName}
                  </p>
                  <p className="text-sm text-muted">
                    → #{channelName.get(feed.channelId) ?? "deleted channel"}
                    {feed.pingRoleId !== null &&
                      ` · pings @${roleName.get(feed.pingRoleId) ?? "deleted role"}`}
                  </p>
                </div>
                <form action={removeSocialFeed}>
                  <HiddenGuild guildId={guildId} />
                  <input type="hidden" name="feedId" value={feed.id} />
                  <Button tone="danger">Remove</Button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {feeds.length < maximumSocialFeedsPerGuild && (
        <Card
          title="Follow a creator"
          description="Only uploads after adding are announced. Twitch needs TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET on the bot."
        >
          <form action={addSocialFeed} className="grid gap-3 sm:grid-cols-2">
            <HiddenGuild guildId={guildId} />
            <Field label="Platform">
              <select name="platform" defaultValue="youtube" className={inputClass}>
                <option value="youtube">YouTube</option>
                <option value="twitch">Twitch</option>
              </select>
            </Field>
            <Field
              label="Creator"
              hint="YouTube: @handle or channel link. Twitch: channel name or link."
            >
              <input name="creator" required maxLength={200} className={inputClass} />
            </Field>
            <Field label="Post in">
              <Picker name="channelId" defaultValue={null} options={textChannels} prefix="#" />
            </Field>
            <Field label="Ping role">
              <Picker
                name="pingRoleId"
                defaultValue={null}
                none="No ping"
                options={roles}
                prefix="@"
              />
            </Field>
            <Field
              label="Message"
              hint={`Placeholders: {creator}, {title}, {url}. Empty uses: ${defaultSocialMessages.youtube}`}
              wide
            >
              <textarea name="message" maxLength={1000} className={textAreaClass} />
            </Field>
            <div className="sm:col-span-2">
              <Button>Follow</Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
