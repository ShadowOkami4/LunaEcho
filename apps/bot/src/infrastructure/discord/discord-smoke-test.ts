import {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  PermissionFlagsBits,
  type GuildBasedChannel,
  type GuildMember,
  type SendableChannels,
} from "discord.js";

import type { AppLogger } from "@lunaecho/core";
import { createPanel } from "./components/panel.js";

export type DiscordSmokeTestOptions = Readonly<{
  channelId: string | undefined;
  guildId: string;
  logger: AppLogger;
  token: string;
}>;

export type DiscordSmokeTestResult = Readonly<{
  channelId: string;
  guildId: string;
  messageId: string;
  messageUrl: string;
}>;

export class DiscordSmokeTestError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "DiscordSmokeTestError";
  }
}

function waitForClientReady(client: Client, timeoutMilliseconds = 15_000): Promise<Client<true>> {
  if (client.isReady()) {
    return Promise.resolve(client);
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new DiscordSmokeTestError("Discord client did not become ready within 15 seconds"));
    }, timeoutMilliseconds);

    client.once(Events.ClientReady, (readyClient) => {
      clearTimeout(timeout);
      resolve(readyClient);
    });
  });
}

function canRunMessageSmokeTest(
  channel: GuildBasedChannel | null,
  member: GuildMember,
): channel is GuildBasedChannel & SendableChannels {
  if (channel === null || channel.isThread() || !channel.isSendable()) {
    return false;
  }

  const permissions = channel.permissionsFor(member);
  return permissions.has([
    PermissionFlagsBits.AddReactions,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ViewChannel,
  ]);
}

function createSmokeTestPanel(body: string) {
  return createPanel({
    body,
    footer: "Automated development check • Components V2",
    title: "LunaEcho Discord smoke test",
    tone: "info",
  });
}

export async function runDiscordSmokeTest(
  options: DiscordSmokeTestOptions,
): Promise<DiscordSmokeTestResult> {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  try {
    await client.login(options.token);
    const readyClient = await waitForClientReady(client);
    const guild = await readyClient.guilds.fetch(options.guildId);
    const member = await guild.members.fetchMe();
    const channels = await guild.channels.fetch();

    let selectedChannel: (GuildBasedChannel & SendableChannels) | undefined;

    if (options.channelId !== undefined) {
      const configuredChannel = channels.get(options.channelId) ?? null;

      if (!canRunMessageSmokeTest(configuredChannel, member)) {
        throw new DiscordSmokeTestError(
          `Configured channel '${options.channelId}' is missing or lacks smoke-test permissions`,
        );
      }

      selectedChannel = configuredChannel;
    } else {
      const systemChannel =
        guild.systemChannelId === null ? null : (channels.get(guild.systemChannelId) ?? null);

      if (canRunMessageSmokeTest(systemChannel, member)) {
        selectedChannel = systemChannel;
      } else {
        selectedChannel = channels.find((channel) => canRunMessageSmokeTest(channel, member));
      }
    }

    if (selectedChannel === undefined) {
      throw new DiscordSmokeTestError(
        "No channel allows viewing, sending messages, reading history, and adding reactions",
      );
    }

    const message = await selectedChannel.send({
      allowedMentions: { parse: [] },
      components: [createSmokeTestPanel("⏳ Running Components V2 message checks…")],
      flags: MessageFlags.IsComponentsV2,
    });

    await message.edit({
      components: [
        createSmokeTestPanel(
          "✅ Message send succeeded.\n✅ Message edit succeeded.\n⏳ Testing reactions…",
        ),
      ],
      flags: MessageFlags.IsComponentsV2,
    });
    await message.react("✅");
    await message.edit({
      components: [
        createSmokeTestPanel(
          "✅ Message send succeeded.\n✅ Message edit succeeded.\n✅ Reaction succeeded.",
        ),
      ],
      flags: MessageFlags.IsComponentsV2,
    });

    const result = {
      channelId: selectedChannel.id,
      guildId: guild.id,
      messageId: message.id,
      messageUrl: `https://discord.com/channels/${guild.id}/${selectedChannel.id}/${message.id}`,
    } satisfies DiscordSmokeTestResult;

    options.logger.info(result, "Discord message smoke test passed");
    return result;
  } finally {
    await client.destroy();
  }
}
