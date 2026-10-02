import { logCategories, maximumIgnoredLogChannels } from "@lunaecho/modules";

import { requireManageableGuild } from "@/lib/access";
import { channelTypes, fetchGuildChannels } from "@/lib/discord";
import { services } from "@/lib/services";

import { Button, Card, Field, HiddenGuild, MultiPicker, Notice, Picker } from "../ui";
import { saveLogSettings } from "./actions";

export const dynamic = "force-dynamic";

const categoryLabels = {
  member: ["Members", "Joins, leaves, nickname and role changes, bans"],
  message: ["Messages", "Edited and deleted messages"],
  moderation: ["Moderation", "Every moderation case, from commands and AutoMod"],
  server: ["Server", "Channels and roles created, changed, or deleted"],
  voice: ["Voice", "Members joining, leaving, and moving between voice channels"],
} as const satisfies Readonly<Record<(typeof logCategories)[number], readonly [string, string]>>;

export default async function LogsPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ guildId: string }>;
  searchParams: Promise<{ notice?: string }>;
}>) {
  const { guildId } = await params;
  await requireManageableGuild(guildId);
  const app = await services();
  app.logs.invalidate(guildId);
  const [settings, channels] = await Promise.all([
    app.logs.get(guildId),
    fetchGuildChannels(guildId),
  ]);
  const textChannels = channels.filter((channel) => channel.type === channelTypes.text);
  const watchable = channels.filter(
    (channel) => channel.type === channelTypes.text || channel.type === channelTypes.voice,
  );

  return (
    <div className="flex flex-col gap-4">
      <Notice code={(await searchParams).notice} />
      <Card
        title="Logs"
        description="Pick a channel for each kind of event. Categories without a channel are not logged. Log entries never ping anyone."
      >
        <form action={saveLogSettings} className="grid gap-3 sm:grid-cols-2">
          <HiddenGuild guildId={guildId} />
          {logCategories.map((category) => (
            <Field
              key={category}
              label={categoryLabels[category][0]}
              hint={categoryLabels[category][1]}
            >
              <Picker
                name={`channel-${category}`}
                defaultValue={settings.channels[category]}
                none="Not logged"
                options={textChannels}
                prefix="#"
              />
            </Field>
          ))}
          <Field
            label="Ignored channels"
            hint={`Messages and voice activity here are never logged (up to ${maximumIgnoredLogChannels}).`}
            wide
          >
            <MultiPicker
              name="ignoredChannelIds"
              defaultValue={settings.ignoredChannelIds}
              options={watchable}
              prefix="#"
            />
          </Field>
          <div className="sm:col-span-2">
            <Button>Save</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
