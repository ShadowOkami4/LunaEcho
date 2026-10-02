import { ExpiringCache, type Clock } from "@lunaecho/core";
import { levelRewards, levelSettings, memberLevels, type LunaDatabase } from "@lunaecho/db";
import { and, asc, count, desc, eq, gt, sql } from "drizzle-orm";

export type AnnounceMode = "channel" | "current" | "off";

export type LevelSettings = Readonly<{
  announceChannelId: string | null;
  announceMode: AnnounceMode;
  announceTemplate: string;
  guildId: string;
  ignoredChannelIds: readonly string[];
  ignoredRoleIds: readonly string[];
  messageCooldownSeconds: number;
  messageXpMax: number;
  messageXpMin: number;
  /** Keep earlier reward roles when a higher one is reached. */
  stackRewards: boolean;
  voiceXpPerMinute: number;
}>;

export type LevelReward = Readonly<{ level: number; roleId: string }>;

export type LevelUp = Readonly<{
  /** Reward roles to add for every level passed on the way. */
  grantRoleIds: readonly string[];
  guildId: string;
  newLevel: number;
  previousLevel: number;
  /** Lower reward roles to remove when rewards do not stack. */
  revokeRoleIds: readonly string[];
  userId: string;
}>;

export type RankCard = Readonly<{
  level: number;
  /** XP gathered inside the current level, and the amount needed for the next one. */
  progress: Readonly<{ current: number; needed: number }>;
  /** 1-based position on the leaderboard; undefined before the first XP. */
  rank: number | undefined;
  totalXp: number;
  userId: string;
}>;

export const maximumLevelRewards = 50;

export class LevelSettingsInputError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "LevelSettingsInputError";
  }
}

/** XP needed to go from `level` to `level + 1`, the curve most Discord level bots use. */
export function xpForNextLevel(level: number): number {
  return 5 * level * level + 50 * level + 100;
}

export function levelFromXp(totalXp: number): Readonly<{ level: number; remainder: number }> {
  let level = 0;
  let remainder = Math.max(0, totalXp);

  while (remainder >= xpForNextLevel(level)) {
    remainder -= xpForNextLevel(level);
    level += 1;
  }

  return { level, remainder };
}

function defaultsFor(guildId: string): LevelSettings {
  return {
    announceChannelId: null,
    announceMode: "current",
    announceTemplate: "{user} reached level {level}!",
    guildId,
    ignoredChannelIds: [],
    ignoredRoleIds: [],
    messageCooldownSeconds: 60,
    messageXpMax: 25,
    messageXpMin: 15,
    stackRewards: true,
    voiceXpPerMinute: 10,
  };
}

function validate(settings: LevelSettings): LevelSettings {
  const within = (value: number, minimum: number, maximum: number): boolean =>
    Number.isInteger(value) && value >= minimum && value <= maximum;

  if (
    !within(settings.messageXpMin, 0, 1_000) ||
    !within(settings.messageXpMax, settings.messageXpMin, 1_000)
  ) {
    throw new LevelSettingsInputError("Message XP must be between 0 and 1000, minimum first.");
  }

  if (!within(settings.messageCooldownSeconds, 0, 3_600)) {
    throw new LevelSettingsInputError("The cooldown must be between 0 and 3600 seconds.");
  }

  if (!within(settings.voiceXpPerMinute, 0, 1_000)) {
    throw new LevelSettingsInputError("Voice XP must be between 0 and 1000 per minute.");
  }

  if (settings.announceMode === "channel" && settings.announceChannelId === null) {
    throw new LevelSettingsInputError("Choose a channel for level-up announcements.");
  }

  const template = settings.announceTemplate.trim();

  if (template.length === 0 || template.length > 500) {
    throw new LevelSettingsInputError(
      "The announcement must contain between 1 and 500 characters.",
    );
  }

  return { ...settings, announceTemplate: template };
}

export class LevelService {
  /** When each member may earn message XP again, as epoch milliseconds. */
  private readonly cooldowns: ExpiringCache<string, number>;
  private readonly settingsCache: ExpiringCache<string, LevelSettings>;
  private readonly rewardCache: ExpiringCache<string, readonly LevelReward[]>;

  public constructor(
    private readonly database: LunaDatabase,
    private readonly clock: Clock = () => new Date(),
    private readonly random: () => number = Math.random,
  ) {
    this.cooldowns = new ExpiringCache({
      clock,
      maximumEntries: 200_000,
      ttlMilliseconds: 3_600_000,
    });
    this.settingsCache = new ExpiringCache({
      clock,
      maximumEntries: 10_000,
      ttlMilliseconds: 60_000,
    });
    this.rewardCache = new ExpiringCache({
      clock,
      maximumEntries: 10_000,
      ttlMilliseconds: 60_000,
    });
  }

  public invalidate(guildId: string): void {
    this.settingsCache.delete(guildId);
    this.rewardCache.delete(guildId);
  }

  public async getSettings(guildId: string): Promise<LevelSettings> {
    const cached = this.settingsCache.get(guildId);

    if (cached !== undefined) {
      return cached;
    }

    const [row] = await this.database
      .select()
      .from(levelSettings)
      .where(eq(levelSettings.guildId, guildId));
    const settings: LevelSettings =
      row === undefined
        ? defaultsFor(guildId)
        : {
            announceChannelId: row.announceChannelId,
            announceMode: row.announceMode as AnnounceMode,
            announceTemplate: row.announceTemplate,
            guildId,
            ignoredChannelIds: row.ignoredChannelIds,
            ignoredRoleIds: row.ignoredRoleIds,
            messageCooldownSeconds: row.messageCooldownSeconds,
            messageXpMax: row.messageXpMax,
            messageXpMin: row.messageXpMin,
            stackRewards: row.stackRewards,
            voiceXpPerMinute: row.voiceXpPerMinute,
          };
    this.settingsCache.set(guildId, settings);
    return settings;
  }

  public async saveSettings(input: LevelSettings, actorId: string): Promise<LevelSettings> {
    const settings = validate(input);
    const values = {
      announceChannelId: settings.announceChannelId,
      announceMode: settings.announceMode,
      announceTemplate: settings.announceTemplate,
      ignoredChannelIds: [...settings.ignoredChannelIds],
      ignoredRoleIds: [...settings.ignoredRoleIds],
      messageCooldownSeconds: settings.messageCooldownSeconds,
      messageXpMax: settings.messageXpMax,
      messageXpMin: settings.messageXpMin,
      stackRewards: settings.stackRewards,
      updatedAt: this.clock(),
      updatedBy: actorId,
      voiceXpPerMinute: settings.voiceXpPerMinute,
    };

    await this.database
      .insert(levelSettings)
      .values({ ...values, guildId: settings.guildId })
      .onConflictDoUpdate({ set: values, target: levelSettings.guildId });
    this.invalidate(settings.guildId);
    return settings;
  }

  public async listRewards(guildId: string): Promise<readonly LevelReward[]> {
    const cached = this.rewardCache.get(guildId);

    if (cached !== undefined) {
      return cached;
    }

    const rewards = await this.database
      .select({ level: levelRewards.level, roleId: levelRewards.roleId })
      .from(levelRewards)
      .where(eq(levelRewards.guildId, guildId))
      .orderBy(asc(levelRewards.level));
    this.rewardCache.set(guildId, rewards);
    return rewards;
  }

  public async setReward(
    guildId: string,
    level: number,
    roleId: string,
  ): Promise<"limit-reached" | "saved"> {
    if (!Number.isInteger(level) || level < 1 || level > 1_000) {
      throw new LevelSettingsInputError("Reward levels must be between 1 and 1000.");
    }

    const existing = await this.listRewards(guildId);

    if (
      existing.length >= maximumLevelRewards &&
      !existing.some((reward) => reward.level === level)
    ) {
      return "limit-reached";
    }

    await this.database
      .insert(levelRewards)
      .values({ guildId, level, roleId })
      .onConflictDoUpdate({ set: { roleId }, target: [levelRewards.guildId, levelRewards.level] });
    this.rewardCache.delete(guildId);
    return "saved";
  }

  public async removeReward(guildId: string, level: number): Promise<void> {
    await this.database
      .delete(levelRewards)
      .where(and(eq(levelRewards.guildId, guildId), eq(levelRewards.level, level)));
    this.rewardCache.delete(guildId);
  }

  /**
   * Awards message XP unless the member is on cooldown, in an ignored channel, or has an
   * ignored role. Returns the level-up, if this message caused one.
   */
  public async awardMessageXp(
    input: Readonly<{
      channelId: string;
      guildId: string;
      roleIds: readonly string[];
      userId: string;
    }>,
  ): Promise<LevelUp | undefined> {
    const settings = await this.getSettings(input.guildId);

    if (
      settings.ignoredChannelIds.includes(input.channelId) ||
      input.roleIds.some((roleId) => settings.ignoredRoleIds.includes(roleId)) ||
      settings.messageXpMax === 0
    ) {
      return undefined;
    }

    const cooldownKey = `${input.guildId}:${input.userId}`;

    const now = this.clock().getTime();

    if ((this.cooldowns.get(cooldownKey) ?? 0) > now) {
      return undefined;
    }

    if (settings.messageCooldownSeconds > 0) {
      this.cooldowns.set(cooldownKey, now + settings.messageCooldownSeconds * 1_000);
    }

    const span = settings.messageXpMax - settings.messageXpMin;
    const amount = settings.messageXpMin + Math.floor(this.random() * (span + 1));
    return this.addXp(input.guildId, input.userId, amount, { messages: 1, voiceMinutes: 0 });
  }

  /** Awards one minute of voice XP to each listed member. */
  public async awardVoiceMinute(guildId: string, userIds: readonly string[]): Promise<LevelUp[]> {
    const settings = await this.getSettings(guildId);

    if (settings.voiceXpPerMinute === 0) {
      return [];
    }

    const levelUps: LevelUp[] = [];

    for (const userId of userIds) {
      const levelUp = await this.addXp(guildId, userId, settings.voiceXpPerMinute, {
        messages: 0,
        voiceMinutes: 1,
      });

      if (levelUp !== undefined) {
        levelUps.push(levelUp);
      }
    }

    return levelUps;
  }

  public async getRank(guildId: string, userId: string): Promise<RankCard> {
    const [row] = await this.database
      .select({ xp: memberLevels.xp })
      .from(memberLevels)
      .where(and(eq(memberLevels.guildId, guildId), eq(memberLevels.userId, userId)));
    const totalXp = row?.xp ?? 0;
    const { level, remainder } = levelFromXp(totalXp);
    let rank: number | undefined;

    if (row !== undefined) {
      const [ahead] = await this.database
        .select({ value: count() })
        .from(memberLevels)
        .where(and(eq(memberLevels.guildId, guildId), gt(memberLevels.xp, totalXp)));
      rank = (ahead?.value ?? 0) + 1;
    }

    return {
      level,
      progress: { current: remainder, needed: xpForNextLevel(level) },
      rank,
      totalXp,
      userId,
    };
  }

  public async leaderboard(
    guildId: string,
    limit: number,
    offset = 0,
  ): Promise<
    readonly Readonly<{ level: number; position: number; totalXp: number; userId: string }>[]
  > {
    const rows = await this.database
      .select({ userId: memberLevels.userId, xp: memberLevels.xp })
      .from(memberLevels)
      .where(eq(memberLevels.guildId, guildId))
      .orderBy(desc(memberLevels.xp), asc(memberLevels.userId))
      .limit(limit)
      .offset(offset);

    return rows.map((row, index) => ({
      level: levelFromXp(row.xp).level,
      position: offset + index + 1,
      totalXp: row.xp,
      userId: row.userId,
    }));
  }

  public async countMembers(guildId: string): Promise<number> {
    const [row] = await this.database
      .select({ value: count() })
      .from(memberLevels)
      .where(eq(memberLevels.guildId, guildId));
    return row?.value ?? 0;
  }

  private async addXp(
    guildId: string,
    userId: string,
    amount: number,
    activity: Readonly<{ messages: number; voiceMinutes: number }>,
  ): Promise<LevelUp | undefined> {
    const now = this.clock();
    const [row] = await this.database
      .insert(memberLevels)
      .values({
        guildId,
        messageCount: activity.messages,
        updatedAt: now,
        userId,
        voiceMinutes: activity.voiceMinutes,
        xp: amount,
      })
      .onConflictDoUpdate({
        set: {
          messageCount: sql`${memberLevels.messageCount} + ${activity.messages}`,
          updatedAt: now,
          voiceMinutes: sql`${memberLevels.voiceMinutes} + ${activity.voiceMinutes}`,
          xp: sql`${memberLevels.xp} + ${amount}`,
        },
        target: [memberLevels.guildId, memberLevels.userId],
      })
      .returning({ xp: memberLevels.xp });

    if (row === undefined) {
      throw new Error("PostgreSQL did not return the member's XP");
    }

    const previousLevel = levelFromXp(row.xp - amount).level;
    const newLevel = levelFromXp(row.xp).level;

    if (newLevel <= previousLevel) {
      return undefined;
    }

    const settings = await this.getSettings(guildId);
    const rewards = await this.listRewards(guildId);
    const reached = rewards.filter((reward) => reward.level <= newLevel);
    const highest = reached.at(-1);
    const passed = reached.filter((reward) => reward.level > previousLevel);

    return {
      grantRoleIds: settings.stackRewards
        ? passed.map((reward) => reward.roleId)
        : highest !== undefined && highest.level > previousLevel
          ? [highest.roleId]
          : [],
      guildId,
      newLevel,
      previousLevel,
      revokeRoleIds:
        settings.stackRewards || highest === undefined || highest.level <= previousLevel
          ? []
          : reached.filter((reward) => reward !== highest).map((reward) => reward.roleId),
      userId,
    };
  }
}
