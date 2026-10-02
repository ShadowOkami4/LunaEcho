import { ExpiringCache, type Clock } from "@lunaecho/core";
import { welcomeCards, type LunaDatabase } from "@lunaecho/db";
import { eq, sql } from "drizzle-orm";

import {
  welcomeCardBackgrounds,
  welcomeCardLayouts,
  type WelcomeCardBackground,
  type WelcomeCardDesign,
} from "./welcome-card-renderer.js";

export const maximumWelcomeCardTextLength = 80;

export type WelcomeCardSettings = WelcomeCardDesign &
  Readonly<{
    goodbyeEnabled: boolean;
    goodbyeSubtitle: string;
    goodbyeTitle: string;
    guildId: string;
    /** Whether a background picture was uploaded. */
    hasBackgroundImage: boolean;
    /** Changes with every save, so renderers know when a cached background is stale. */
    version: number;
    welcomeEnabled: boolean;
    welcomeSubtitle: string;
    welcomeTitle: string;
  }>;

export type WelcomeCardInput = Omit<WelcomeCardSettings, "hasBackgroundImage" | "version">;

export class WelcomeCardInputError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "WelcomeCardInputError";
  }
}

export const defaultWelcomeCard: Omit<WelcomeCardSettings, "guildId"> = {
  accentColor: "#ff85d2",
  background: "luna",
  goodbyeEnabled: false,
  goodbyeSubtitle: "{server} now has {memberCount} members",
  goodbyeTitle: "Goodbye, {username}",
  hasBackgroundImage: false,
  layout: "centered",
  overlayOpacity: 25,
  textColor: "#ffffff",
  version: 0,
  welcomeEnabled: false,
  welcomeSubtitle: "Member #{memberCount} of {server}",
  welcomeTitle: "Welcome, {username}!",
};

/** Placeholders for card texts. A card cannot ping, so {user} also shows the name. */
export function renderWelcomeCardText(
  template: string,
  values: Readonly<{ displayName: string; memberCount: number; serverName: string }>,
): string {
  return template
    .replaceAll("{user}", values.displayName)
    .replaceAll("{username}", values.displayName)
    .replaceAll("{server}", values.serverName)
    .replaceAll("{memberCount}", values.memberCount.toLocaleString("en-US"));
}

const colorPattern = /^#[0-9a-f]{6}$/i;

function validate(input: WelcomeCardInput): WelcomeCardInput {
  if (!welcomeCardLayouts.includes(input.layout)) {
    throw new WelcomeCardInputError("Choose a layout.");
  }

  if (!welcomeCardBackgrounds.includes(input.background)) {
    throw new WelcomeCardInputError("Choose a background.");
  }

  if (!colorPattern.test(input.accentColor) || !colorPattern.test(input.textColor)) {
    throw new WelcomeCardInputError("Colours must look like #ff85d2.");
  }

  if (
    !Number.isInteger(input.overlayOpacity) ||
    input.overlayOpacity < 0 ||
    input.overlayOpacity > 80
  ) {
    throw new WelcomeCardInputError("The darkening must be between 0 and 80 percent.");
  }

  const texts = {
    goodbyeSubtitle: input.goodbyeSubtitle.trim(),
    goodbyeTitle: input.goodbyeTitle.trim(),
    welcomeSubtitle: input.welcomeSubtitle.trim(),
    welcomeTitle: input.welcomeTitle.trim(),
  };

  if (Object.values(texts).some((text) => text.length > maximumWelcomeCardTextLength)) {
    throw new WelcomeCardInputError(
      `Card texts can have at most ${maximumWelcomeCardTextLength} characters.`,
    );
  }

  if (texts.welcomeTitle.length === 0 || texts.goodbyeTitle.length === 0) {
    throw new WelcomeCardInputError("Both cards need a title.");
  }

  return {
    ...input,
    accentColor: input.accentColor.toLowerCase(),
    textColor: input.textColor.toLowerCase(),
    ...texts,
  };
}

export class WelcomeCardService {
  private readonly cache: ExpiringCache<string, WelcomeCardSettings>;

  public constructor(
    private readonly database: LunaDatabase,
    private readonly clock: Clock = () => new Date(),
  ) {
    this.cache = new ExpiringCache({ clock, maximumEntries: 10_000, ttlMilliseconds: 60_000 });
  }

  public invalidate(guildId: string): void {
    this.cache.delete(guildId);
  }

  public async get(guildId: string): Promise<WelcomeCardSettings> {
    const cached = this.cache.get(guildId);

    if (cached !== undefined) {
      return cached;
    }

    const [row] = await this.database
      .select({
        accentColor: welcomeCards.accentColor,
        background: welcomeCards.background,
        goodbyeEnabled: welcomeCards.goodbyeEnabled,
        goodbyeSubtitle: welcomeCards.goodbyeSubtitle,
        goodbyeTitle: welcomeCards.goodbyeTitle,
        hasBackgroundImage: sql<boolean>`${welcomeCards.backgroundImage} IS NOT NULL`,
        layout: welcomeCards.layout,
        overlayOpacity: welcomeCards.overlayOpacity,
        textColor: welcomeCards.textColor,
        updatedAt: welcomeCards.updatedAt,
        welcomeEnabled: welcomeCards.welcomeEnabled,
        welcomeSubtitle: welcomeCards.welcomeSubtitle,
        welcomeTitle: welcomeCards.welcomeTitle,
      })
      .from(welcomeCards)
      .where(eq(welcomeCards.guildId, guildId));
    const settings: WelcomeCardSettings =
      row === undefined
        ? { ...defaultWelcomeCard, guildId }
        : {
            accentColor: row.accentColor,
            background: row.background as WelcomeCardBackground,
            goodbyeEnabled: row.goodbyeEnabled,
            goodbyeSubtitle: row.goodbyeSubtitle,
            goodbyeTitle: row.goodbyeTitle,
            guildId,
            hasBackgroundImage: row.hasBackgroundImage,
            layout: row.layout,
            overlayOpacity: row.overlayOpacity,
            textColor: row.textColor,
            version: row.updatedAt.getTime(),
            welcomeEnabled: row.welcomeEnabled,
            welcomeSubtitle: row.welcomeSubtitle,
            welcomeTitle: row.welcomeTitle,
          };
    this.cache.set(guildId, settings);
    return settings;
  }

  /** The uploaded background, already prepared by prepareWelcomeCardBackground. */
  public async getBackgroundImage(guildId: string): Promise<Uint8Array | undefined> {
    const [row] = await this.database
      .select({ image: welcomeCards.backgroundImage })
      .from(welcomeCards)
      .where(eq(welcomeCards.guildId, guildId));
    return row?.image ?? undefined;
  }

  /** Saves the design; the uploaded background is kept as it is. */
  public async save(input: WelcomeCardInput, actorId: string): Promise<void> {
    const design = validate(input);
    const values = {
      accentColor: design.accentColor,
      background: design.background,
      goodbyeEnabled: design.goodbyeEnabled,
      goodbyeSubtitle: design.goodbyeSubtitle,
      goodbyeTitle: design.goodbyeTitle,
      layout: design.layout,
      overlayOpacity: design.overlayOpacity,
      textColor: design.textColor,
      updatedAt: this.clock(),
      updatedBy: actorId,
      welcomeEnabled: design.welcomeEnabled,
      welcomeSubtitle: design.welcomeSubtitle,
      welcomeTitle: design.welcomeTitle,
    };
    await this.database
      .insert(welcomeCards)
      .values({ ...values, guildId: design.guildId })
      .onConflictDoUpdate({ set: values, target: welcomeCards.guildId });
    this.cache.delete(design.guildId);
  }

  /** Stores a prepared background (or removes it with null) and switches the card to it. */
  public async setBackgroundImage(
    guildId: string,
    image: Uint8Array | null,
    actorId: string,
  ): Promise<void> {
    const current = await this.get(guildId);
    const background: WelcomeCardBackground =
      image === null ? (current.background === "image" ? "luna" : current.background) : "image";
    const values = {
      accentColor: current.accentColor,
      background,
      backgroundImage: image,
      goodbyeEnabled: current.goodbyeEnabled,
      goodbyeSubtitle: current.goodbyeSubtitle,
      goodbyeTitle: current.goodbyeTitle,
      layout: current.layout,
      overlayOpacity: current.overlayOpacity,
      textColor: current.textColor,
      updatedAt: this.clock(),
      updatedBy: actorId,
      welcomeEnabled: current.welcomeEnabled,
      welcomeSubtitle: current.welcomeSubtitle,
      welcomeTitle: current.welcomeTitle,
    };
    await this.database
      .insert(welcomeCards)
      .values({ ...values, guildId })
      .onConflictDoUpdate({ set: values, target: welcomeCards.guildId });
    this.cache.delete(guildId);
  }
}
