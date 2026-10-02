import { toError, type AppLogger } from "@lunaecho/core";
import type { LevelService, LevelUp, RankCard } from "@lunaecho/modules";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
  type Client,
  type Guild,
  type MessageActionRowComponentBuilder,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord.js";

import type { ChatInputCommand } from "../../infrastructure/discord/commands/chat-input-command.js";
import type {
  ComponentInteractionHandler,
  RoutedComponentInteraction,
} from "../../infrastructure/discord/commands/component-interaction-registry.js";
import {
  respondWithPanelEphemerally,
  updatePanel,
} from "../../infrastructure/discord/commands/interaction-responder.js";
import { createPanel, type PanelOptions } from "../../infrastructure/discord/components/panel.js";

export const rankPanelPrefix = "rank:";
const leaderboardPageSize = 10;
const progressBarLength = 20;

export const rankCommandData: RESTPostAPIChatInputApplicationCommandsJSONBody =
  new SlashCommandBuilder()
    .setName("rank")
    .setDescription("Show your level, or another member's.")
    .setContexts(InteractionContextType.Guild)
    .addUserOption((option) => option.setName("member").setDescription("Defaults to you."))
    .toJSON();

function progressBar(current: number, needed: number): string {
  const filled = Math.round((current / Math.max(1, needed)) * progressBarLength);
  return `${"█".repeat(filled)}${"░".repeat(progressBarLength - filled)}`;
}

function leaderboardButton(page: number, label: string, disabled = false): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(`${rankPanelPrefix}page:${page}`)
    .setLabel(label)
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(disabled);
}

export function createRankPanel(card: RankCard): PanelOptions {
  return {
    body: [
      `<@${card.userId}>`,
      `**Level ${card.level}** · ${card.rank === undefined ? "not ranked yet" : `rank #${card.rank}`}`,
      `\`${progressBar(card.progress.current, card.progress.needed)}\``,
      `${card.progress.current.toLocaleString("en-US")} / ${card.progress.needed.toLocaleString("en-US")} XP to level ${card.level + 1} · ${card.totalXp.toLocaleString("en-US")} XP in total`,
    ].join("\n"),
    rows: [
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        leaderboardButton(0, "Leaderboard"),
      ),
    ],
    title: "Rank",
  };
}

async function createLeaderboardPanel(
  service: LevelService,
  guildId: string,
  page: number,
): Promise<PanelOptions> {
  const total = await service.countMembers(guildId);
  const pages = Math.max(1, Math.ceil(total / leaderboardPageSize));
  const current = Math.min(Math.max(0, page), pages - 1);
  const entries = await service.leaderboard(
    guildId,
    leaderboardPageSize,
    current * leaderboardPageSize,
  );

  return {
    body:
      entries.length === 0
        ? "Nobody has earned XP yet."
        : entries
            .map(
              (entry) =>
                `\`#${entry.position}\` <@${entry.userId}> · level ${entry.level} · ${entry.totalXp.toLocaleString("en-US")} XP`,
            )
            .join("\n"),
    footer: `Page ${current + 1} of ${pages}`,
    rows: [
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        leaderboardButton(current - 1, "Previous", current === 0),
        leaderboardButton(current + 1, "Next", current >= pages - 1),
      ),
    ],
    title: "Leaderboard",
  };
}

export function createRankCommand(service: LevelService): ChatInputCommand {
  return {
    data: rankCommandData,
    guildOnly: true,
    requiredCapability: "levels",

    async execute({ interaction }): Promise<void> {
      if (interaction.guildId === null) {
        throw new Error("Rank command executed outside a guild");
      }

      const user = interaction.options.getUser("member") ?? interaction.user;
      await respondWithPanelEphemerally(
        interaction,
        createRankPanel(await service.getRank(interaction.guildId, user.id)),
      );
    },
  };
}

export class LeaderboardPanelHandler implements ComponentInteractionHandler {
  public readonly customIdPrefix = rankPanelPrefix;
  public readonly requiredCapability = "levels";

  public constructor(private readonly service: LevelService) {}

  public async handle(interaction: RoutedComponentInteraction): Promise<void> {
    if (!interaction.isButton() || interaction.guildId === null) {
      return;
    }

    const page = Number(interaction.customId.split(":").at(-1));
    await updatePanel(
      interaction,
      await createLeaderboardPanel(
        this.service,
        interaction.guildId,
        Number.isInteger(page) ? page : 0,
      ),
    );
  }
}

export function renderAnnouncement(
  template: string,
  userId: string,
  username: string,
  level: number,
): string {
  return template
    .replaceAll("{user}", `<@${userId}>`)
    .replaceAll("{username}", username)
    .replaceAll("{level}", String(level));
}

/** Grants reward roles and posts the announcement for one level-up. */
export async function applyLevelUp(
  service: LevelService,
  guild: Guild,
  levelUp: LevelUp,
  fallbackChannelId: string | null,
  logger: AppLogger,
): Promise<void> {
  for (const roleId of levelUp.grantRoleIds) {
    await guild.members
      .addRole({ reason: `Level ${levelUp.newLevel} reward`, role: roleId, user: levelUp.userId })
      .catch((error: unknown) => {
        logger.warn(
          { err: toError(error), guildId: guild.id, roleId },
          "Could not grant a level reward",
        );
      });
  }

  for (const roleId of levelUp.revokeRoleIds) {
    await guild.members
      .removeRole({
        reason: "Replaced by a higher level reward",
        role: roleId,
        user: levelUp.userId,
      })
      .catch((error: unknown) => {
        logger.warn(
          { err: toError(error), guildId: guild.id, roleId },
          "Could not remove a level reward",
        );
      });
  }

  const settings = await service.getSettings(guild.id);
  const channelId =
    settings.announceMode === "channel"
      ? settings.announceChannelId
      : settings.announceMode === "current"
        ? fallbackChannelId
        : null;

  if (channelId === null) {
    return;
  }

  const channel = guild.channels.cache.get(channelId);

  if (!channel?.isSendable()) {
    return;
  }

  const user = await guild.client.users.fetch(levelUp.userId).catch(() => undefined);
  await channel.send({
    allowedMentions: { users: [levelUp.userId] },
    components: [
      createPanel({
        body: renderAnnouncement(
          settings.announceTemplate,
          levelUp.userId,
          user?.username ?? "member",
          levelUp.newLevel,
        ),
        title: `Level ${levelUp.newLevel}`,
        tone: "success",
      }),
    ],
    flags: MessageFlags.IsComponentsV2,
  });
}

const voiceTickMilliseconds = 60_000;

/** Once a minute, members talking together in voice earn voice XP. */
export class VoiceXpTicker {
  private timer: ReturnType<typeof setInterval> | undefined;

  public constructor(
    private readonly service: LevelService,
    private readonly client: Client,
    private readonly moduleRuns: (guildId: string) => Promise<boolean>,
    private readonly logger: AppLogger,
  ) {}

  public start(): void {
    this.timer = setInterval(() => {
      void this.tick().catch((error: unknown) => {
        this.logger.error({ err: toError(error) }, "Voice XP tick failed");
      });
    }, voiceTickMilliseconds);
    this.timer.unref();
  }

  public close(): Promise<void> {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
    }

    return Promise.resolve();
  }

  public async tick(): Promise<void> {
    for (const guild of this.client.guilds.cache.values()) {
      const eligible = eligibleVoiceMembers(guild);

      if (eligible.length === 0 || !(await this.moduleRuns(guild.id))) {
        continue;
      }

      for (const levelUp of await this.service.awardVoiceMinute(guild.id, eligible)) {
        await applyLevelUp(this.service, guild, levelUp, null, this.logger);
      }
    }
  }
}

/**
 * Members count when they are not deafened, not in the AFK channel, and share their channel with
 * at least one other person, so idling alone in voice earns nothing.
 */
export function eligibleVoiceMembers(guild: Guild): string[] {
  const byChannel = new Map<string, string[]>();

  for (const state of guild.voiceStates.cache.values()) {
    if (
      state.channelId === null ||
      state.channelId === guild.afkChannelId ||
      state.deaf === true ||
      state.member?.user.bot === true ||
      state.channel?.type === ChannelType.GuildStageVoice
    ) {
      continue;
    }

    byChannel.set(state.channelId, [...(byChannel.get(state.channelId) ?? []), state.id]);
  }

  return [...byChannel.values()].filter((members) => members.length >= 2).flat();
}
