import { ExpiringCache, type Clock } from "@lunaecho/core";
import { welcomeSettings, type LunaDatabase } from "@lunaecho/db";
import { eq } from "drizzle-orm";

export const maximumAutoroles = 10;
export const maximumWelcomeMessageLength = 1_500;

export type WelcomeSettings = Readonly<{
  autoroleIds: readonly string[];
  directMessage: string | null;
  goodbyeChannelId: string | null;
  goodbyeMessage: string | null;
  guildId: string;
  verificationChannelId: string | null;
  verificationMessageId: string | null;
  verificationRoleId: string | null;
  verificationText: string | null;
  welcomeChannelId: string | null;
  welcomeMessage: string | null;
}>;

export type WelcomeTemplateValues = Readonly<{
  memberCount: number;
  serverName: string;
  userId: string;
  username: string;
}>;

export class WelcomeSettingsInputError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "WelcomeSettingsInputError";
  }
}

/** Placeholders: {user} mentions the member, {username}, {server}, {memberCount}. */
export function renderWelcomeTemplate(template: string, values: WelcomeTemplateValues): string {
  return template
    .replaceAll("{user}", `<@${values.userId}>`)
    .replaceAll("{username}", values.username)
    .replaceAll("{server}", values.serverName)
    .replaceAll("{memberCount}", values.memberCount.toLocaleString("en-US"));
}

function defaultsFor(guildId: string): WelcomeSettings {
  return {
    autoroleIds: [],
    directMessage: null,
    goodbyeChannelId: null,
    goodbyeMessage: null,
    guildId,
    verificationChannelId: null,
    verificationMessageId: null,
    verificationRoleId: null,
    verificationText: null,
    welcomeChannelId: null,
    welcomeMessage: null,
  };
}

/** Empty texts mean "off"; everything else must fit into one Discord message. */
function cleanText(value: string | null): string | null {
  const text = value?.trim() ?? "";

  if (text.length > maximumWelcomeMessageLength) {
    throw new WelcomeSettingsInputError(
      `Messages can have at most ${maximumWelcomeMessageLength} characters.`,
    );
  }

  return text.length === 0 ? null : text;
}

export class WelcomeSettingsService {
  private readonly cache: ExpiringCache<string, WelcomeSettings>;

  public constructor(
    private readonly database: LunaDatabase,
    private readonly clock: Clock = () => new Date(),
  ) {
    this.cache = new ExpiringCache({ clock, maximumEntries: 10_000, ttlMilliseconds: 60_000 });
  }

  public invalidate(guildId: string): void {
    this.cache.delete(guildId);
  }

  public async get(guildId: string): Promise<WelcomeSettings> {
    const cached = this.cache.get(guildId);

    if (cached !== undefined) {
      return cached;
    }

    const [row] = await this.database
      .select()
      .from(welcomeSettings)
      .where(eq(welcomeSettings.guildId, guildId));
    const settings: WelcomeSettings =
      row === undefined
        ? defaultsFor(guildId)
        : {
            autoroleIds: row.autoroleIds,
            directMessage: row.directMessage,
            goodbyeChannelId: row.goodbyeChannelId,
            goodbyeMessage: row.goodbyeMessage,
            guildId,
            verificationChannelId: row.verificationChannelId,
            verificationMessageId: row.verificationMessageId,
            verificationRoleId: row.verificationRoleId,
            verificationText: row.verificationText,
            welcomeChannelId: row.welcomeChannelId,
            welcomeMessage: row.welcomeMessage,
          };
    this.cache.set(guildId, settings);
    return settings;
  }

  /** Saves everything except the posted panel's message id, which only the bot sets. */
  public async save(input: WelcomeSettings, actorId: string): Promise<WelcomeSettings> {
    const autoroleIds = [...new Set(input.autoroleIds)];

    if (autoroleIds.length > maximumAutoroles) {
      throw new WelcomeSettingsInputError(`At most ${maximumAutoroles} autoroles are allowed.`);
    }

    const settings: WelcomeSettings = {
      ...input,
      autoroleIds,
      directMessage: cleanText(input.directMessage),
      goodbyeMessage: cleanText(input.goodbyeMessage),
      verificationText: cleanText(input.verificationText),
      welcomeMessage: cleanText(input.welcomeMessage),
    };
    const values = {
      autoroleIds,
      directMessage: settings.directMessage,
      goodbyeChannelId: settings.goodbyeChannelId,
      goodbyeMessage: settings.goodbyeMessage,
      updatedAt: this.clock(),
      updatedBy: actorId,
      verificationChannelId: settings.verificationChannelId,
      verificationRoleId: settings.verificationRoleId,
      verificationText: settings.verificationText,
      welcomeChannelId: settings.welcomeChannelId,
      welcomeMessage: settings.welcomeMessage,
    };

    await this.database
      .insert(welcomeSettings)
      .values({ ...values, guildId: settings.guildId })
      .onConflictDoUpdate({ set: values, target: welcomeSettings.guildId });
    this.cache.delete(settings.guildId);
    return settings;
  }

  /** Remembers which message holds the verification button, so a new post replaces it. */
  public async setVerificationMessage(guildId: string, messageId: string | null): Promise<void> {
    await this.database
      .update(welcomeSettings)
      .set({ verificationMessageId: messageId })
      .where(eq(welcomeSettings.guildId, guildId));
    this.cache.delete(guildId);
  }
}
