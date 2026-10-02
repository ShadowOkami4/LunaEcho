import { maximumAutoroles, maximumWelcomeMessageLength } from "@lunaecho/modules";

import { requireManageableGuild } from "@/lib/access";
import { channelTypes, fetchGuildChannels, fetchGuildRoles } from "@/lib/discord";
import { services } from "@/lib/services";

import {
  Button,
  Card,
  Field,
  HiddenGuild,
  MultiPicker,
  Notice,
  Picker,
  textAreaClass,
} from "../ui";
import { postVerificationPanel, saveWelcomeSettings } from "./actions";

export const dynamic = "force-dynamic";

const placeholders = "Placeholders: {user}, {username}, {server}, {memberCount}. Empty = off.";

export default async function WelcomePage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ guildId: string }>;
  searchParams: Promise<{ notice?: string }>;
}>) {
  const { guildId } = await params;
  await requireManageableGuild(guildId);
  const app = await services();
  app.welcome.invalidate(guildId);
  const [settings, channels, roles] = await Promise.all([
    app.welcome.get(guildId),
    fetchGuildChannels(guildId),
    fetchGuildRoles(guildId),
  ]);
  const textChannels = channels.filter((channel) => channel.type === channelTypes.text);

  return (
    <div className="flex flex-col gap-4">
      <Notice code={(await searchParams).notice} />
      <form action={saveWelcomeSettings} className="flex flex-col gap-4">
        <HiddenGuild guildId={guildId} />

        <Card title="Welcome & goodbye" description="Messages for members who join or leave.">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Welcome channel">
              <Picker
                name="welcomeChannelId"
                defaultValue={settings.welcomeChannelId}
                none="No welcome message"
                options={textChannels}
                prefix="#"
              />
            </Field>
            <Field label="Goodbye channel">
              <Picker
                name="goodbyeChannelId"
                defaultValue={settings.goodbyeChannelId}
                none="No goodbye message"
                options={textChannels}
                prefix="#"
              />
            </Field>
            <Field label="Welcome message" hint={placeholders}>
              <textarea
                name="welcomeMessage"
                maxLength={maximumWelcomeMessageLength}
                defaultValue={settings.welcomeMessage ?? "Welcome to {server}, {user}! 🌙"}
                className={textAreaClass}
              />
            </Field>
            <Field label="Goodbye message" hint={placeholders}>
              <textarea
                name="goodbyeMessage"
                maxLength={maximumWelcomeMessageLength}
                defaultValue={settings.goodbyeMessage ?? "{username} left the server."}
                className={textAreaClass}
              />
            </Field>
            <Field
              label="Direct message to new members"
              hint="Sent privately. Members who block server DMs simply do not get it."
              wide
            >
              <textarea
                name="directMessage"
                maxLength={maximumWelcomeMessageLength}
                defaultValue={settings.directMessage ?? ""}
                className={textAreaClass}
              />
            </Field>
          </div>
        </Card>

        <Card
          title="Autoroles"
          description={`Given to every new member once they pass Discord's membership screening. Up to ${maximumAutoroles} roles; LunaEcho's role must be above them.`}
        >
          <MultiPicker
            name="autoroleIds"
            defaultValue={settings.autoroleIds}
            options={roles}
            prefix="@"
          />
        </Card>

        <Card
          title="Verification"
          description="A button members press to get a role, for example the role that unlocks your channels."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Panel channel">
              <Picker
                name="verificationChannelId"
                defaultValue={settings.verificationChannelId}
                none="No verification"
                options={textChannels}
                prefix="#"
              />
            </Field>
            <Field label="Role to give">
              <Picker
                name="verificationRoleId"
                defaultValue={settings.verificationRoleId}
                none="None"
                options={roles}
                prefix="@"
              />
            </Field>
            <Field label="Panel text" wide>
              <textarea
                name="verificationText"
                maxLength={maximumWelcomeMessageLength}
                defaultValue={settings.verificationText ?? ""}
                placeholder="Welcome! Press the button below to confirm you are human and unlock the server."
                className={textAreaClass}
              />
            </Field>
          </div>
        </Card>

        <div>
          <Button>Save</Button>
        </div>
      </form>

      <Card
        title="Post the verification panel"
        description={
          settings.verificationMessageId === null
            ? "Save first, then post. Posting again replaces the old panel."
            : "A panel is posted. Posting again replaces it, for example after changing the text."
        }
      >
        <form action={postVerificationPanel}>
          <HiddenGuild guildId={guildId} />
          <Button tone="neutral">Post panel</Button>
        </form>
      </Card>
    </div>
  );
}
