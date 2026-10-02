export const maximumLobbiesPerGuild = 10;
export const maximumRoomNameLength = 100;
export const maximumRoomUserLimit = 99;
export const defaultRoomNameTemplate = "{user}'s Room";

/**
 * Discord allows 500 channels per server. Rooms stop well below that so a busy server keeps room
 * for its regular channels.
 */
export const technicalMaximumRoomsPerGuild = 200;

/** A member can open at most one room in this interval, which stops join/leave spam. */
export const roomCreationCooldownMilliseconds = 10_000;

export type VoiceRoomLobby = Readonly<{
  categoryId: string | null;
  channelId: string;
  createdAt: Date;
  createdBy: string;
  guildId: string;
  nameTemplate: string;
  userLimit: number;
}>;

export type VoiceRoom = Readonly<{
  channelId: string;
  createdAt: Date;
  guildId: string;
  lobbyChannelId: string;
  ownerId: string;
}>;

export class VoiceRoomInputError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "VoiceRoomInputError";
  }
}

/** Replaces `{user}` with the owner's display name and keeps the result a valid channel name. */
export function renderRoomName(template: string, displayName: string): string {
  const name = template.replaceAll("{user}", displayName).trim().replace(/\s+/gu, " ");
  const fallback = name.length === 0 ? "Voice Room" : name;
  return Array.from(fallback).slice(0, maximumRoomNameLength).join("");
}

export function validateRoomName(input: string): string {
  const name = input.trim().replace(/\s+/gu, " ");

  if (name.length === 0) {
    throw new VoiceRoomInputError("The room name cannot be empty.");
  }

  if (Array.from(name).length > maximumRoomNameLength) {
    throw new VoiceRoomInputError(
      `The room name cannot exceed ${maximumRoomNameLength} characters.`,
    );
  }

  return name;
}

export function validateUserLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 0 || limit > maximumRoomUserLimit) {
    throw new VoiceRoomInputError(
      `The user limit must be between 0 (no limit) and ${maximumRoomUserLimit}.`,
    );
  }

  return limit;
}

export function validateNameTemplate(input: string): string {
  const template = input.trim();

  if (template.length === 0 || Array.from(template).length > maximumRoomNameLength) {
    throw new VoiceRoomInputError(
      `The name template must contain between 1 and ${maximumRoomNameLength} characters.`,
    );
  }

  return template;
}
