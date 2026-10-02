import type { VoiceRoom, VoiceRoomLobby } from "./voice-room.js";

export type SaveLobbyResult = "created" | "limit-reached" | "updated";

export interface VoiceRoomRepository {
  createRoom(room: VoiceRoom): Promise<void>;
  deleteRoom(channelId: string): Promise<void>;
  listLobbies(guildId: string): Promise<VoiceRoomLobby[]>;
  listRooms(guildId: string): Promise<VoiceRoom[]>;
  /** Guilds that still have stored rooms, so a restart can clean up rooms emptied while offline. */
  listRoomGuildIds(): Promise<string[]>;
  removeLobby(guildId: string, channelId: string): Promise<boolean>;
  saveLobby(lobby: VoiceRoomLobby, maximumLobbies: number): Promise<SaveLobbyResult>;
  setRoomOwner(channelId: string, ownerId: string): Promise<void>;
}
