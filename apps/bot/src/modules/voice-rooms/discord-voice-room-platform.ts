import type {
  CreateRoomRequest,
  RoomAccess,
  RoomDetails,
  VoiceRoomPlatform,
} from "@lunaecho/modules";
import {
  ChannelType,
  PermissionFlagsBits,
  type Client,
  type Guild,
  type OverwriteData,
  type VoiceChannel,
} from "discord.js";

const ownerPermissions = [
  "ViewChannel",
  "Connect",
  "Speak",
  "Stream",
  "UseVAD",
  "PrioritySpeaker",
] as const satisfies readonly (keyof typeof PermissionFlagsBits)[];
const ownerAllow = ownerPermissions.map((name) => PermissionFlagsBits[name]);

/** The bot must keep managing a room even when the lobby's overwrites would lock it out. */
const botAllow = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.Connect,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.MoveMembers,
];

const auditReason = "LunaEcho voice room";

export class DiscordVoiceRoomPlatform implements VoiceRoomPlatform {
  public constructor(private readonly client: Client) {}

  public async createRoom(request: CreateRoomRequest): Promise<string> {
    const guild = this.requireGuild(request.guildId);
    const lobby = guild.channels.cache.get(request.lobbyChannelId);
    const lobbyOverwrites: OverwriteData[] =
      lobby !== undefined && "permissionOverwrites" in lobby
        ? lobby.permissionOverwrites.cache.map((overwrite) => ({
            allow: overwrite.allow,
            deny: overwrite.deny,
            id: overwrite.id,
            type: overwrite.type,
          }))
        : [];
    const channel = await guild.channels.create({
      name: request.name,
      parent: request.parentId ?? lobby?.parentId ?? null,
      permissionOverwrites: [
        ...lobbyOverwrites.filter(
          (overwrite) => overwrite.id !== request.ownerId && overwrite.id !== this.botId(),
        ),
        { allow: ownerAllow, id: request.ownerId },
        { allow: botAllow, id: this.botId() },
      ],
      reason: auditReason,
      type: ChannelType.GuildVoice,
      userLimit: request.userLimit,
    });

    return channel.id;
  }

  public async deleteRoom(guildId: string, channelId: string): Promise<void> {
    await this.requireGuild(guildId).channels.delete(channelId, auditReason);
  }

  public async disconnectMember(guildId: string, userId: string): Promise<void> {
    await this.requireGuild(guildId).members.edit(userId, { channel: null, reason: auditReason });
  }

  public getRoomDetails(guildId: string, channelId: string): RoomDetails | undefined {
    const channel = this.findVoiceChannel(guildId, channelId);

    if (channel === undefined) {
      return undefined;
    }

    const everyone = channel.permissionOverwrites.cache.get(guildId);

    return {
      hidden: everyone?.deny.has(PermissionFlagsBits.ViewChannel) ?? false,
      locked: everyone?.deny.has(PermissionFlagsBits.Connect) ?? false,
      name: channel.name,
      userLimit: channel.userLimit,
    };
  }

  public async grantOwnerPermissions(
    guildId: string,
    channelId: string,
    ownerId: string,
  ): Promise<void> {
    await this.requireVoiceChannel(guildId, channelId).permissionOverwrites.edit(
      ownerId,
      Object.fromEntries(ownerPermissions.map((name) => [name, true])),
      { reason: auditReason },
    );
  }

  public async moveMember(guildId: string, userId: string, channelId: string): Promise<void> {
    // Editing by id works without the member being cached.
    await this.requireGuild(guildId).members.edit(userId, { channel: channelId });
  }

  /**
   * Read from voice states, never from `channel.members`: that property resolves members from the
   * member cache, which LunaEcho limits, so it could miss people who are still connected.
   */
  public occupantIds(guildId: string, channelId: string): readonly string[] {
    const guild = this.client.guilds.cache.get(guildId);

    return guild === undefined
      ? []
      : [...guild.voiceStates.cache.filter((state) => state.channelId === channelId).keys()];
  }

  public async renameRoom(guildId: string, channelId: string, name: string): Promise<void> {
    await this.requireVoiceChannel(guildId, channelId).setName(name, auditReason);
  }

  public async revokeOwnerPermissions(
    guildId: string,
    channelId: string,
    ownerId: string,
  ): Promise<void> {
    await this.requireVoiceChannel(guildId, channelId).permissionOverwrites.delete(
      ownerId,
      auditReason,
    );
  }

  public roomExists(guildId: string, channelId: string): boolean {
    return this.client.guilds.cache.get(guildId)?.channels.cache.has(channelId) ?? false;
  }

  public async setMemberAccess(
    guildId: string,
    channelId: string,
    userId: string,
    access: "permit" | "reject",
  ): Promise<void> {
    await this.requireVoiceChannel(guildId, channelId).permissionOverwrites.edit(
      userId,
      access === "permit" ? { Connect: true, ViewChannel: true } : { Connect: false },
      { reason: auditReason },
    );
  }

  public async setRoomAccess(
    guildId: string,
    channelId: string,
    access: Partial<RoomAccess>,
  ): Promise<void> {
    // Null removes the deny again instead of granting the permission to everyone.
    await this.requireVoiceChannel(guildId, channelId).permissionOverwrites.edit(
      guildId,
      {
        ...(access.locked === undefined ? {} : { Connect: access.locked ? false : null }),
        ...(access.hidden === undefined ? {} : { ViewChannel: access.hidden ? false : null }),
      },
      { reason: auditReason },
    );
  }

  public async setUserLimit(guildId: string, channelId: string, userLimit: number): Promise<void> {
    await this.requireVoiceChannel(guildId, channelId).setUserLimit(userLimit, auditReason);
  }

  private botId(): string {
    const user = this.client.user;

    if (user === null) {
      throw new Error("The Discord client is not logged in");
    }

    return user.id;
  }

  private findVoiceChannel(guildId: string, channelId: string): VoiceChannel | undefined {
    const channel = this.client.guilds.cache.get(guildId)?.channels.cache.get(channelId);
    return channel?.type === ChannelType.GuildVoice ? channel : undefined;
  }

  private requireGuild(guildId: string): Guild {
    const guild = this.client.guilds.cache.get(guildId);

    if (guild === undefined) {
      throw new Error(`Guild ${guildId} is not available`);
    }

    return guild;
  }

  private requireVoiceChannel(guildId: string, channelId: string): VoiceChannel {
    const channel = this.findVoiceChannel(guildId, channelId);

    if (channel === undefined) {
      throw new Error(`Voice room ${channelId} was not found`);
    }

    return channel;
  }
}
