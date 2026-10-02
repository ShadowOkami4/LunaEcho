import { voiceRoomLobbies, voiceRooms, type LunaDatabase } from "@lunaecho/db";
import { and, asc, count, eq, sql } from "drizzle-orm";

import type { SaveLobbyResult, VoiceRoomRepository } from "./voice-room-repository.js";
import type { VoiceRoom, VoiceRoomLobby } from "./voice-room.js";

export class DrizzleVoiceRoomRepository implements VoiceRoomRepository {
  public constructor(private readonly database: LunaDatabase) {}

  public async createRoom(room: VoiceRoom): Promise<void> {
    await this.database.insert(voiceRooms).values(room);
  }

  public async deleteRoom(channelId: string): Promise<void> {
    await this.database.delete(voiceRooms).where(eq(voiceRooms.channelId, channelId));
  }

  public listLobbies(guildId: string): Promise<VoiceRoomLobby[]> {
    return this.database
      .select()
      .from(voiceRoomLobbies)
      .where(eq(voiceRoomLobbies.guildId, guildId))
      .orderBy(asc(voiceRoomLobbies.createdAt), asc(voiceRoomLobbies.channelId));
  }

  public listRooms(guildId: string): Promise<VoiceRoom[]> {
    return this.database
      .select()
      .from(voiceRooms)
      .where(eq(voiceRooms.guildId, guildId))
      .orderBy(asc(voiceRooms.createdAt), asc(voiceRooms.channelId));
  }

  public async listRoomGuildIds(): Promise<string[]> {
    const rows = await this.database
      .selectDistinct({ guildId: voiceRooms.guildId })
      .from(voiceRooms);
    return rows.map((row) => row.guildId);
  }

  public async removeLobby(guildId: string, channelId: string): Promise<boolean> {
    const removed = await this.database
      .delete(voiceRoomLobbies)
      .where(and(eq(voiceRoomLobbies.guildId, guildId), eq(voiceRoomLobbies.channelId, channelId)))
      .returning({ channelId: voiceRoomLobbies.channelId });
    return removed.length > 0;
  }

  public saveLobby(lobby: VoiceRoomLobby, maximumLobbies: number): Promise<SaveLobbyResult> {
    return this.database.transaction(async (transaction) => {
      const ofGuild = eq(voiceRoomLobbies.guildId, lobby.guildId);
      const updated = await transaction
        .update(voiceRoomLobbies)
        .set({
          categoryId: lobby.categoryId,
          nameTemplate: lobby.nameTemplate,
          userLimit: lobby.userLimit,
        })
        .where(and(ofGuild, eq(voiceRoomLobbies.channelId, lobby.channelId)))
        .returning({ channelId: voiceRoomLobbies.channelId });

      if (updated.length > 0) {
        return "updated";
      }

      // Serializes concurrent lobby creation for one guild so the limit cannot be exceeded.
      await transaction.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`voice_room_lobbies:${lobby.guildId}`}))`,
      );
      const [lobbyCount] = await transaction
        .select({ value: count() })
        .from(voiceRoomLobbies)
        .where(ofGuild);

      if (lobbyCount === undefined || lobbyCount.value >= maximumLobbies) {
        return "limit-reached";
      }

      await transaction.insert(voiceRoomLobbies).values(lobby);
      return "created";
    });
  }

  public async setRoomOwner(channelId: string, ownerId: string): Promise<void> {
    await this.database
      .update(voiceRooms)
      .set({ ownerId })
      .where(eq(voiceRooms.channelId, channelId));
  }
}
