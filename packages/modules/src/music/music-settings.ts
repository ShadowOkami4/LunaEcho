import { ExpiringCache, type Clock } from "@lunaecho/core";
import { guildMusicSettings, type LunaDatabase } from "@lunaecho/db";
import { eq } from "drizzle-orm";

import { defaultVolume, maximumVolume } from "./music-track.js";

export type MusicSettings = Readonly<{
  defaultVolume: number;
  /** When set, only members with this role (or Manage Server) may control playback. */
  djRoleId: string | null;
  guildId: string;
}>;

export type MusicSettingsUpdate = Readonly<{
  defaultVolume?: number;
  djRoleId?: string | null;
}>;

export interface MusicSettingsRepository {
  get(guildId: string): Promise<MusicSettings>;
  save(settings: MusicSettings, actorId: string, updatedAt: Date): Promise<void>;
}

export class MusicSettingsInputError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "MusicSettingsInputError";
  }
}

function defaultsFor(guildId: string): MusicSettings {
  return { defaultVolume, djRoleId: null, guildId };
}

export class DrizzleMusicSettingsRepository implements MusicSettingsRepository {
  public constructor(private readonly database: LunaDatabase) {}

  public async get(guildId: string): Promise<MusicSettings> {
    const [row] = await this.database
      .select({
        defaultVolume: guildMusicSettings.defaultVolume,
        djRoleId: guildMusicSettings.djRoleId,
      })
      .from(guildMusicSettings)
      .where(eq(guildMusicSettings.guildId, guildId));

    return row === undefined ? defaultsFor(guildId) : { ...row, guildId };
  }

  public async save(settings: MusicSettings, actorId: string, updatedAt: Date): Promise<void> {
    const values = {
      defaultVolume: settings.defaultVolume,
      djRoleId: settings.djRoleId,
      updatedAt,
      updatedBy: actorId,
    };

    await this.database
      .insert(guildMusicSettings)
      .values({ ...values, guildId: settings.guildId })
      .onConflictDoUpdate({ set: values, target: guildMusicSettings.guildId });
  }
}

export class InMemoryMusicSettingsRepository implements MusicSettingsRepository {
  private readonly settings = new Map<string, MusicSettings>();

  public get(guildId: string): Promise<MusicSettings> {
    return Promise.resolve(this.settings.get(guildId) ?? defaultsFor(guildId));
  }

  public save(settings: MusicSettings): Promise<void> {
    this.settings.set(settings.guildId, settings);
    return Promise.resolve();
  }
}

export class MusicSettingsService {
  private readonly cache: ExpiringCache<string, MusicSettings>;

  public constructor(
    private readonly repository: MusicSettingsRepository,
    private readonly clock: Clock = () => new Date(),
  ) {
    this.cache = new ExpiringCache({ clock, maximumEntries: 10_000, ttlMilliseconds: 30_000 });
  }

  /** Drops the cached settings, for example after the dashboard changed them. */
  public invalidate(guildId: string): void {
    this.cache.delete(guildId);
  }

  public async get(guildId: string): Promise<MusicSettings> {
    const cached = this.cache.get(guildId);

    if (cached !== undefined) {
      return cached;
    }

    const settings = await this.repository.get(guildId);
    this.cache.set(guildId, settings);
    return settings;
  }

  public async update(
    guildId: string,
    update: MusicSettingsUpdate,
    actorId: string,
  ): Promise<MusicSettings> {
    if (
      update.defaultVolume !== undefined &&
      (!Number.isInteger(update.defaultVolume) ||
        update.defaultVolume < 0 ||
        update.defaultVolume > maximumVolume)
    ) {
      throw new MusicSettingsInputError(`The volume must be between 0 and ${maximumVolume}.`);
    }

    const next = { ...(await this.repository.get(guildId)), ...update };
    await this.repository.save(next, actorId, this.clock());
    this.cache.delete(guildId);
    return next;
  }
}
