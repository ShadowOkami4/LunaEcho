import { maximumOpenTicketsPerMemberLimit, maximumTicketStaffRoles } from "@lunaecho/modules";

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
import { postTicketPanel, saveTicketSettings } from "./actions";

export const dynamic = "force-dynamic";

export default async function TicketsPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ guildId: string }>;
  searchParams: Promise<{ notice?: string }>;
}>) {
  const { guildId } = await params;
  await requireManageableGuild(guildId);
  const app = await services();
  app.tickets.invalidate(guildId);
  const [settings, open, channels, roles] = await Promise.all([
    app.tickets.getSettings(guildId),
    app.tickets.countOpen(guildId),
    fetchGuildChannels(guildId),
    fetchGuildRoles(guildId),
  ]);
  const textChannels = channels.filter((channel) => channel.type === channelTypes.text);

  return (
    <div className="flex flex-col gap-4">
      <Notice code={(await searchParams).notice} />
      <Card
        icon="tune"
        title="Ticket setup"
        description={`Members open a private thread with your team by pressing a button. ${open} tickets are open right now.`}
      >
        <form action={saveTicketSettings} className="grid gap-3 sm:grid-cols-2">
          <HiddenGuild guildId={guildId} />
          <Field
            label="Ticket channel"
            hint="The panel is posted here, and tickets open as private threads below it."
          >
            <Picker
              name="panelChannelId"
              defaultValue={settings.panelChannelId}
              none="Tickets off"
              options={textChannels}
              prefix="#"
            />
          </Field>
          <Field label="Transcript channel" hint="Closed tickets are saved here as a text file.">
            <Picker
              name="transcriptChannelId"
              defaultValue={settings.transcriptChannelId}
              none="No transcripts"
              options={textChannels}
              prefix="#"
            />
          </Field>
          <Field
            label="Team roles"
            hint={`Mentioned in new tickets and allowed to claim them (up to ${maximumTicketStaffRoles}). Members with Manage Threads always can.`}
          >
            <MultiPicker
              name="staffRoleIds"
              defaultValue={settings.staffRoleIds}
              options={roles}
              prefix="@"
            />
          </Field>
          <Field label="Open tickets per member">
            <input
              name="maximumOpenPerMember"
              type="number"
              min={1}
              max={maximumOpenTicketsPerMemberLimit}
              defaultValue={settings.maximumOpenPerMember}
              className={inputClass}
            />
          </Field>
          <Field label="Panel title">
            <input
              name="panelTitle"
              maxLength={100}
              defaultValue={settings.panelTitle ?? ""}
              placeholder="Support"
              className={inputClass}
            />
          </Field>
          <Field label="Panel text" wide>
            <textarea
              name="panelText"
              maxLength={1500}
              defaultValue={settings.panelText ?? ""}
              placeholder="Need help from the team? Open a ticket and describe your request."
              className={textAreaClass}
            />
          </Field>
          <div className="sm:col-span-2">
            <Button>Save</Button>
          </div>
        </form>
      </Card>

      <Card
        icon="send"
        title="Post the ticket panel"
        description="LunaEcho needs Create Private Threads, Send Messages in Threads, and Manage Threads in the ticket channel. Posting again replaces the old panel."
      >
        <form action={postTicketPanel}>
          <HiddenGuild guildId={guildId} />
          <Button tone="neutral" icon="send">
            Post panel
          </Button>
        </form>
      </Card>
    </div>
  );
}
