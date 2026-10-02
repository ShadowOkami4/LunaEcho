import {
  defaultRoomNameTemplate,
  maximumLobbiesPerGuild,
  maximumRoomUserLimit,
} from "@lunaecho/modules";

import { requireManageableGuild } from "@/lib/access";
import { channelTypes, fetchGuildChannels } from "@/lib/discord";
import { services } from "@/lib/services";

import { removeVoiceLobby, saveVoiceLobby } from "../actions";
import { Button, Card, HiddenGuild, inputClass, ListItem, Notice } from "../ui";

export const dynamic = "force-dynamic";

export default async function VoiceRoomsPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ guildId: string }>;
  searchParams: Promise<{ notice?: string }>;
}>) {
  const { guildId } = await params;
  await requireManageableGuild(guildId);
  const app = await services();
  const [lobbies, rooms, channels] = await Promise.all([
    app.voiceRooms.listLobbies(guildId),
    app.voiceRooms.listRooms(guildId),
    fetchGuildChannels(guildId),
  ]);
  const channelName = new Map(channels.map((channel) => [channel.id, channel.name]));
  const lobbyIds = new Set(lobbies.map((lobby) => lobby.channelId));
  const roomIds = new Set(rooms.map((room) => room.channelId));
  const voiceChannels = channels.filter(
    (channel) =>
      channel.type === channelTypes.voice && !lobbyIds.has(channel.id) && !roomIds.has(channel.id),
  );
  const categories = channels.filter((channel) => channel.type === channelTypes.category);

  return (
    <div className="flex flex-col gap-4">
      <Notice code={(await searchParams).notice} />

      <Card
        icon="headphones"
        title="Lobbies"
        description={`Joining a lobby opens a private room for that member. ${lobbies.length}/${maximumLobbiesPerGuild} lobbies · ${rooms.length} rooms open now.`}
      >
        {lobbies.length === 0 ? (
          <p className="text-sm text-muted">No lobbies yet. Pick a voice channel below.</p>
        ) : (
          <ul className="divide-y divide-outline/60">
            {lobbies.map((lobby) => (
              <ListItem
                key={lobby.channelId}
                icon="headphones"
                title={channelName.get(lobby.channelId) ?? lobby.channelId}
                supporting={
                  <>
                    Room name “{lobby.nameTemplate}” · limit{" "}
                    {lobby.userLimit === 0 ? "none" : lobby.userLimit} · category{" "}
                    {lobby.categoryId === null
                      ? "same as lobby"
                      : (channelName.get(lobby.categoryId) ?? lobby.categoryId)}
                  </>
                }
              >
                <form action={removeVoiceLobby}>
                  <HiddenGuild guildId={guildId} />
                  <input type="hidden" name="channelId" value={lobby.channelId} />
                  <Button tone="remove" icon="delete">
                    Remove
                  </Button>
                </form>
              </ListItem>
            ))}
          </ul>
        )}
      </Card>

      <Card
        icon="add"
        title="Add a lobby"
        description="Use {user} in the name to insert the owner's display name."
      >
        <form action={saveVoiceLobby} className="grid gap-3 sm:grid-cols-2">
          <HiddenGuild guildId={guildId} />
          <label className="flex flex-col gap-1 text-sm">
            Voice channel
            <select name="channelId" required className={inputClass}>
              {voiceChannels.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {channel.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Category for new rooms
            <select name="categoryId" className={inputClass}>
              <option value="">Same as the lobby</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Room name
            <input
              name="nameTemplate"
              defaultValue={defaultRoomNameTemplate}
              maxLength={100}
              required
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Member limit (0 = none)
            <input
              name="userLimit"
              type="number"
              min={0}
              max={maximumRoomUserLimit}
              defaultValue={0}
              className={inputClass}
            />
          </label>
          <div className="sm:col-span-2">
            <Button icon="add">Add lobby</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
