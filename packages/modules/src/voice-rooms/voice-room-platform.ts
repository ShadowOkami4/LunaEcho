export type CreateRoomRequest = Readonly<{
  guildId: string;
  /** The lobby's permission overwrites are copied so a room is visible to the same members. */
  lobbyChannelId: string;
  name: string;
  ownerId: string;
  parentId: string | null;
  userLimit: number;
}>;

export type RoomAccess = Readonly<{
  hidden: boolean;
  locked: boolean;
}>;

export type RoomDetails = RoomAccess &
  Readonly<{
    name: string;
    userLimit: number;
  }>;

/**
 * Everything the voice room logic needs from Discord. The Discord adapter implements it for the
 * bot, and the load simulation implements it in memory.
 */
export interface VoiceRoomPlatform {
  createRoom(request: CreateRoomRequest): Promise<string>;
  deleteRoom(guildId: string, channelId: string): Promise<void>;
  disconnectMember(guildId: string, userId: string): Promise<void>;
  getRoomDetails(guildId: string, channelId: string): RoomDetails | undefined;
  grantOwnerPermissions(guildId: string, channelId: string, ownerId: string): Promise<void>;
  moveMember(guildId: string, userId: string, channelId: string): Promise<void>;
  /** Member ids currently connected to a channel, read from the voice state cache. */
  occupantIds(guildId: string, channelId: string): readonly string[];
  renameRoom(guildId: string, channelId: string, name: string): Promise<void>;
  revokeOwnerPermissions(guildId: string, channelId: string, ownerId: string): Promise<void>;
  roomExists(guildId: string, channelId: string): boolean;
  setMemberAccess(
    guildId: string,
    channelId: string,
    userId: string,
    access: "permit" | "reject",
  ): Promise<void>;
  setRoomAccess(guildId: string, channelId: string, access: Partial<RoomAccess>): Promise<void>;
  setUserLimit(guildId: string, channelId: string, userLimit: number): Promise<void>;
}
