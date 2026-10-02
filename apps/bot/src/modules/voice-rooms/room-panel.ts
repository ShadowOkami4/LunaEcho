import type { RoomActionResult, RoomActor, RoomInfo, VoiceRoomService } from "@lunaecho/modules";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  UserSelectMenuBuilder,
  type Interaction,
  type MessageActionRowComponentBuilder,
} from "discord.js";

import type { PanelOptions } from "../../infrastructure/discord/components/panel.js";

export const roomPanelPrefix = "room:";

/** Custom ids of the room panel; forms end in "-form", member pickers are user selects. */
export const roomPanelIds = {
  claim: "room:claim",
  hide: "room:hide",
  kick: "room:kick",
  limit: "room:limit",
  limitForm: "room:limit-form",
  lock: "room:lock",
  permit: "room:permit",
  refresh: "room:refresh",
  reject: "room:reject",
  rename: "room:rename",
  renameForm: "room:rename-form",
  show: "room:show",
  transfer: "room:transfer",
  unlock: "room:unlock",
} as const;

export const roomResultMessages = {
  done: "",
  "invalid-target":
    "That member cannot be chosen: owners cannot target themselves, and kick and hand over need someone inside the room.",
  "not-in-room": "Join one of LunaEcho's voice rooms first.",
  "not-owner": "Only the room's owner can do that. Claim the room once the owner has left.",
  "owner-present": "The owner is still in the room.",
  "rate-limited": "Discord allows two renames per room every 10 minutes. Try again later.",
} as const satisfies Record<RoomActionResult, string>;

export function resolveRoomActor(interaction: Interaction<"cached">): RoomActor {
  return {
    channelId: interaction.guild.voiceStates.cache.get(interaction.user.id)?.channelId ?? null,
    userId: interaction.user.id,
  };
}

function button(id: string, label: string, style = ButtonStyle.Secondary): ButtonBuilder {
  return new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
}

function memberPicker(
  id: string,
  placeholder: string,
): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new UserSelectMenuBuilder().setCustomId(id).setPlaceholder(placeholder).setMaxValues(1),
  );
}

/** The panel for the room the member is in, with controls only an owner may use. */
export function createRoomPanel(
  info: RoomInfo | undefined,
  actorId: string,
  notice?: string,
): PanelOptions {
  const prefix = notice === undefined || notice === "" ? "" : `> ${notice}\n\n`;

  if (info === undefined) {
    return {
      body: `${prefix}${roomResultMessages["not-in-room"]} Joining a lobby channel opens a room for you.`,
      title: "Your voice room",
      tone: "neutral",
    };
  }

  const details = info.details;
  const locked = details?.locked === true;
  const hidden = details?.hidden === true;
  const summary = [
    `${prefix}**Owner:** <@${info.room.ownerId}>`,
    `**Members inside:** ${info.occupantCount} · **Limit:** ${details === undefined || details.userLimit === 0 ? "none" : details.userLimit}`,
    `**Locked:** ${locked ? "yes" : "no"} · **Hidden:** ${hidden ? "yes" : "no"}`,
  ].join("\n");
  const title = details?.name ?? "Voice room";

  if (info.room.ownerId !== actorId) {
    return {
      body: summary,
      footer: "Only the owner can change this room.",
      rows: [
        new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
          button(roomPanelIds.claim, "Claim room", ButtonStyle.Primary),
          button(roomPanelIds.refresh, "Refresh"),
        ),
      ],
      title,
    };
  }

  return {
    body: summary,
    footer: "Changes apply to the room you are in right now.",
    rows: [
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        button(roomPanelIds.rename, "Rename"),
        button(roomPanelIds.limit, "Member limit"),
        locked ? button(roomPanelIds.unlock, "Unlock") : button(roomPanelIds.lock, "Lock"),
        hidden ? button(roomPanelIds.show, "Show") : button(roomPanelIds.hide, "Hide"),
        button(roomPanelIds.refresh, "Refresh"),
      ),
      memberPicker(roomPanelIds.permit, "Allow a member to join…"),
      memberPicker(roomPanelIds.reject, "Block a member…"),
      memberPicker(roomPanelIds.kick, "Disconnect a member…"),
      memberPicker(roomPanelIds.transfer, "Hand the room over to…"),
    ],
    title,
    tone: "success",
  };
}

/** Runs a button or member-picker action; forms are handled separately. */
export function runRoomPanelAction(
  service: VoiceRoomService,
  guildId: string,
  actor: RoomActor,
  customId: string,
  selectedUserId: string | undefined,
): Promise<RoomActionResult> {
  const target = selectedUserId ?? "";

  switch (customId) {
    case roomPanelIds.lock:
    case roomPanelIds.unlock:
      return service.setLocked(guildId, actor, customId === roomPanelIds.lock);
    case roomPanelIds.hide:
    case roomPanelIds.show:
      return service.setHidden(guildId, actor, customId === roomPanelIds.hide);
    case roomPanelIds.claim:
      return service.claimRoom(guildId, actor);
    case roomPanelIds.permit:
      return service.permitMember(guildId, actor, target);
    case roomPanelIds.reject:
      return service.rejectMember(guildId, actor, target);
    case roomPanelIds.kick:
      return service.kickMember(guildId, actor, target);
    case roomPanelIds.transfer:
      return service.transferRoom(guildId, actor, target);
    default:
      return Promise.resolve("done");
  }
}
