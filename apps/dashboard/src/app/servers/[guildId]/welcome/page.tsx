import { maximumAutoroles, maximumWelcomeMessageLength } from "@lunaecho/modules";

import { channelTypes } from "@/lib/discord";
import { workspaceFor } from "@/lib/workspace";

import {
  Button,
  buttonClass,
  Card,
  Field,
  HiddenGuild,
  MultiPicker,
  Notice,
  Picker,
  textAreaClass,
} from "../ui";
import {
  postVerificationPanel,
  removeWelcomeBackground,
  saveWelcomeCard,
  saveWelcomeSettings,
  uploadWelcomeBackground,
} from "./actions";
import { CardDesigner } from "./card-designer";

export const dynamic = "force-dynamic";

const placeholders = "Placeholders: {user}, {username}, {server}, {memberCount}. Empty means off.";

export default async function WelcomePage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ botId?: string; guildId: string }>;
  searchParams: Promise<{ notice?: string }>;
}>) {
  const { app, discord, guildId, scope } = await workspaceFor(params);
  app.welcome.invalidate(guildId);
  app.welcomeCards.invalidate(guildId);
  const [settings, card, channels, roles] = await Promise.all([
    app.welcome.get(guildId),
    app.welcomeCards.get(guildId),
    discord.channels(),
    discord.roles(),
  ]);
  const textChannels = channels.filter((channel) => channel.type === channelTypes.text);
  const channelName = new Map(channels.map((channel) => [channel.id, channel.name]));
  const verificationSummary =
    settings.verificationChannelId === null || settings.verificationRoleId === null
      ? "Off. Members press a button to get a role, for example the one that unlocks your channels."
      : `Panel in #${channelName.get(settings.verificationChannelId) ?? "deleted channel"}${
          settings.verificationMessageId === null ? ", not posted yet" : ""
        }.`;

  return (
    <div className="flex flex-col gap-4">
      <Notice code={(await searchParams).notice} />

      <form action={saveWelcomeSettings} className="flex flex-col gap-4">
        <HiddenGuild scope={scope} />

        <Card
          collapsible
          icon="chat"
          title="Messages"
          description="Where and what LunaEcho writes when members join or leave."
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="flex flex-col gap-3 rounded-m3-lg bg-surface p-4">
              <p className="title-medium">Joining</p>
              <Field label="Channel">
                <Picker
                  name="welcomeChannelId"
                  defaultValue={settings.welcomeChannelId}
                  none="Off"
                  options={textChannels}
                  prefix="#"
                />
              </Field>
              <Field label="Message" hint={placeholders}>
                <textarea
                  name="welcomeMessage"
                  maxLength={maximumWelcomeMessageLength}
                  defaultValue={settings.welcomeMessage ?? "Welcome to {server}, {user}!"}
                  className={textAreaClass}
                />
              </Field>
            </div>
            <div className="flex flex-col gap-3 rounded-m3-lg bg-surface p-4">
              <p className="title-medium">Leaving</p>
              <Field label="Channel">
                <Picker
                  name="goodbyeChannelId"
                  defaultValue={settings.goodbyeChannelId}
                  none="Off"
                  options={textChannels}
                  prefix="#"
                />
              </Field>
              <Field label="Message" hint={placeholders}>
                <textarea
                  name="goodbyeMessage"
                  maxLength={maximumWelcomeMessageLength}
                  defaultValue={settings.goodbyeMessage ?? "{username} left the server."}
                  className={textAreaClass}
                />
              </Field>
            </div>
          </div>
          <Field
            label="Direct message to new members"
            hint="Sent privately. Members who block server DMs simply do not get it."
          >
            <textarea
              name="directMessage"
              maxLength={maximumWelcomeMessageLength}
              defaultValue={settings.directMessage ?? ""}
              className={textAreaClass}
            />
          </Field>
        </Card>

        <Card
          collapsible
          icon="personAdd"
          title="Autoroles"
          description={`Given to every new member once they pass Discord's membership screening. Up to ${maximumAutoroles} roles; LunaEcho's role must be above them.`}
        >
          <MultiPicker
            name="autoroleIds"
            maximum={maximumAutoroles}
            defaultValue={settings.autoroleIds}
            options={roles}
            prefix="@"
          />
        </Card>

        <Card
          collapsible
          defaultOpen={false}
          icon="verified"
          title="Verification"
          description={verificationSummary}
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
          <div className="flex flex-wrap items-center gap-3 rounded-m3-lg bg-surface px-4 py-3">
            <p className="flex-1 text-sm text-muted">
              Save first, then post. Posting again replaces the old panel.
            </p>
            <button
              type="submit"
              formAction={postVerificationPanel}
              className={buttonClass("neutral")}
            >
              Post panel
            </button>
          </div>
        </Card>

        <div className="flex justify-end">
          <Button icon="checkCircle">Save messages and roles</Button>
        </div>
      </form>

      <Card
        collapsible
        icon="image"
        title="Welcome card"
        description="A picture with the member's avatar and name, sent with the welcome or goodbye message. It also works without a message text."
      >
        <CardDesigner
          action={saveWelcomeCard}
          scope={scope}
          hasBackgroundImage={card.hasBackgroundImage}
          initial={{
            accentColor: card.accentColor,
            background: card.background,
            goodbyeEnabled: card.goodbyeEnabled,
            goodbyeSubtitle: card.goodbyeSubtitle,
            goodbyeTitle: card.goodbyeTitle,
            layout: card.layout,
            overlayOpacity: card.overlayOpacity,
            textColor: card.textColor,
            welcomeEnabled: card.welcomeEnabled,
            welcomeSubtitle: card.welcomeSubtitle,
            welcomeTitle: card.welcomeTitle,
          }}
        />

        <div className="flex flex-col gap-3 rounded-m3-lg bg-surface p-4 sm:flex-row sm:items-center">
          <div className="flex-1">
            <p className="font-medium">Background picture</p>
            <p className="text-sm text-muted">
              PNG, JPEG, or WebP up to 5 MB. LunaEcho crops it to 1024 × 450 and stores a copy.
            </p>
          </div>
          <form action={uploadWelcomeBackground} className="flex flex-wrap items-center gap-2">
            <HiddenGuild scope={scope} />
            <input
              type="file"
              name="background"
              accept="image/png,image/jpeg,image/webp"
              required
              className="max-w-56 text-sm text-muted file:mr-3 file:rounded-full file:border-0 file:bg-secondary-container file:px-4 file:py-2 file:text-sm file:font-semibold file:text-on-secondary-container"
            />
            <Button tone="neutral" icon="upload">
              Upload
            </Button>
          </form>
          {card.hasBackgroundImage && (
            <form action={removeWelcomeBackground}>
              <HiddenGuild scope={scope} />
              <Button tone="remove" icon="delete">
                Remove
              </Button>
            </form>
          )}
        </div>
      </Card>
    </div>
  );
}
