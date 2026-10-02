import { ExpiringCache, toError, type AppLogger } from "@lunaecho/core";
import {
  renderWelcomeCard,
  renderWelcomeCardText,
  type WelcomeCardService,
} from "@lunaecho/modules";
import { AttachmentBuilder, type GuildMember, type PartialGuildMember } from "discord.js";

const avatarTimeoutMilliseconds = 5_000;

/** Draws the welcome and goodbye cards for members, as Discord attachments. */
export class WelcomeCardPainter {
  /** Uploaded backgrounds by guild and design version, so a new upload is used at once. */
  private readonly backgrounds = new ExpiringCache<string, Uint8Array | null>({
    clock: () => new Date(),
    maximumEntries: 200,
    ttlMilliseconds: 10 * 60_000,
  });

  public constructor(
    private readonly cards: WelcomeCardService,
    private readonly logger: AppLogger,
  ) {}

  public invalidate(guildId: string): void {
    this.cards.invalidate(guildId);
  }

  /** The card for this member, or undefined when the server has it switched off. */
  public async paint(
    member: GuildMember | PartialGuildMember,
    kind: "goodbye" | "welcome",
  ): Promise<AttachmentBuilder | undefined> {
    const card = await this.cards.get(member.guild.id);

    if (!(kind === "welcome" ? card.welcomeEnabled : card.goodbyeEnabled)) {
      return undefined;
    }

    try {
      const values = {
        displayName: member.displayName,
        memberCount: member.guild.memberCount,
        serverName: member.guild.name,
      };
      const png = await renderWelcomeCard({
        backgroundImage: await this.background(member.guild.id, card.version, card.background),
        content: {
          avatar: await this.avatar(member),
          displayName: member.displayName,
          subtitle: renderWelcomeCardText(
            kind === "welcome" ? card.welcomeSubtitle : card.goodbyeSubtitle,
            values,
          ),
          title: renderWelcomeCardText(
            kind === "welcome" ? card.welcomeTitle : card.goodbyeTitle,
            values,
          ),
        },
        design: card,
      });
      return new AttachmentBuilder(png, { name: `${kind}.png` });
    } catch (error) {
      // A broken card must never cost the member their welcome message.
      this.logger.warn({ err: toError(error), guildId: member.guild.id }, "Could not draw a card");
      return undefined;
    }
  }

  private async background(
    guildId: string,
    version: number,
    background: string,
  ): Promise<Uint8Array | undefined> {
    if (background !== "image") {
      return undefined;
    }

    const key = `${guildId}:${version}`;
    let image = this.backgrounds.get(key);

    if (image === undefined) {
      image = (await this.cards.getBackgroundImage(guildId)) ?? null;
      this.backgrounds.set(key, image);
    }

    return image ?? undefined;
  }

  /** Avatars come from Discord's CDN only; a slow or failed download draws initials instead. */
  private async avatar(member: GuildMember | PartialGuildMember): Promise<Uint8Array | undefined> {
    try {
      const response = await fetch(member.displayAvatarURL({ extension: "png", size: 256 }), {
        signal: AbortSignal.timeout(avatarTimeoutMilliseconds),
      });
      return response.ok ? new Uint8Array(await response.arrayBuffer()) : undefined;
    } catch {
      return undefined;
    }
  }
}
