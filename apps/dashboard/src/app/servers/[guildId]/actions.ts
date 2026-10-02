"use server";

import { isModuleId } from "@lunaecho/core";
import {
  automodRuleActions,
  automodRuleKinds,
  AutomodThresholdInputError,
  BannedWordInputError,
  getAutomodThresholdConstraints,
  isConfigurableAutomodProfile,
  maximumLobbiesPerGuild,
  MusicSettingsInputError,
  validateNameTemplate,
  validateUserLimit,
  VoiceRoomInputError,
} from "@lunaecho/modules";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireManageableGuild } from "@/lib/access";
import { channelTypes, fetchGuildChannels, fetchGuildRoles } from "@/lib/discord";
import { services } from "@/lib/services";

import { sections } from "./sections";

const snowflake = z.string().regex(/^\d{17,20}$/);

/** Every action re-checks access: a form can be replayed long after the page was loaded. */
async function authorize(formData: FormData) {
  const guildId = snowflake.parse(formData.get("guildId"));
  const { session } = await requireManageableGuild(guildId);
  return { actorId: session.user.id, guildId, services: await services() };
}

function done(guildId: string, page: string, notice: string): never {
  const path = `/servers/${guildId}${page}`;
  revalidatePath(path);
  redirect(`${path}?notice=${encodeURIComponent(notice)}`);
}

/** Ids come from the browser, so they must belong to this server and have the right type. */
async function requireChannel(
  guildId: string,
  channelId: string,
  types: readonly number[],
): Promise<string> {
  const channel = (await fetchGuildChannels(guildId)).find(
    (candidate) => candidate.id === channelId,
  );

  if (channel === undefined || !types.includes(channel.type)) {
    done(guildId, "", "invalid");
  }

  return channel.id;
}

async function requireRole(guildId: string, roleId: string): Promise<string> {
  if (!(await fetchGuildRoles(guildId)).some((role) => role.id === roleId)) {
    done(guildId, "", "invalid");
  }

  return roleId;
}

function text(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value : "";
}

export async function setModuleEnabled(formData: FormData): Promise<void> {
  const { actorId, guildId, services: app } = await authorize(formData);
  const moduleId = text(formData, "moduleId");

  if (!isModuleId(moduleId)) {
    await app.tasks.enqueue("settings-changed", guildId, { module: "modules" });
    done(guildId, "", "unknown-module");
  }

  const result = await app.moduleSettings.setEnabled(
    guildId,
    moduleId,
    text(formData, "enabled") === "true",
    actorId,
  );
  await app.tasks.enqueue("settings-changed", guildId, { module: "modules" });
  // The switch exists on the overview and on each module's own page; return to where it was.
  const returnTo = text(formData, "returnTo");
  const page = sections.some((section) => section.href === returnTo) ? returnTo : "";
  done(guildId, page, result === "not-available" ? "module-planned" : "saved");
}

export async function applyAutomodProfile(formData: FormData): Promise<void> {
  const { actorId, guildId, services: app } = await authorize(formData);
  const profile = text(formData, "profile");

  if (!isConfigurableAutomodProfile(profile)) {
    await app.tasks.enqueue("settings-changed", guildId, { module: "moderation" });
    done(guildId, "/moderation", "invalid");
  }

  await app.moderationSettings.applyAutomodProfile(guildId, profile, actorId);
  await app.tasks.enqueue("settings-changed", guildId, { module: "moderation" });
  done(guildId, "/moderation", "saved");
}

/** The form states the wanted value; toggling only when it differs makes resubmits harmless. */
export async function setModerationFlag(formData: FormData): Promise<void> {
  const { guildId, services: app } = await authorize(formData);
  const flag = z
    .enum(["bannedWords", "dmNotifications", "staffExempt"])
    .parse(formData.get("flag"));
  const wanted = text(formData, "enabled") === "true";
  const settings = await app.moderationSettings.getSettings(guildId);
  const current = {
    bannedWords: settings.bannedWordsEnabled,
    dmNotifications: settings.dmNotificationsEnabled,
    staffExempt: settings.staffExempt,
  }[flag];

  if (current !== wanted) {
    if (flag === "bannedWords") {
      await app.moderationSettings.toggleBannedWords(guildId);
    } else if (flag === "dmNotifications") {
      await app.moderationSettings.toggleDmNotifications(guildId);
    } else {
      await app.moderationSettings.toggleStaffExempt(guildId);
    }
  }

  await app.tasks.enqueue("settings-changed", guildId, { module: "moderation" });

  done(guildId, "/moderation", "saved");
}

export async function addBannedWord(formData: FormData): Promise<void> {
  const { actorId, guildId, services: app } = await authorize(formData);

  try {
    const result = await app.moderationSettings.addBannedWord(
      guildId,
      text(formData, "word"),
      actorId,
    );
    await app.tasks.enqueue("settings-changed", guildId, { module: "moderation" });
    done(guildId, "/moderation", result.status === "added" ? "saved" : result.status);
  } catch (error) {
    if (error instanceof BannedWordInputError) {
      await app.tasks.enqueue("settings-changed", guildId, { module: "moderation" });
      done(guildId, "/moderation", "invalid-word");
    }

    throw error;
  }
}

export async function removeBannedWord(formData: FormData): Promise<void> {
  const { guildId, services: app } = await authorize(formData);
  await app.moderationSettings.removeBannedWord(guildId, text(formData, "word"));
  await app.tasks.enqueue("settings-changed", guildId, { module: "moderation" });
  done(guildId, "/moderation", "saved");
}

export async function updateAutomodRule(formData: FormData): Promise<void> {
  const { actorId, guildId, services: app } = await authorize(formData);
  const kind = z.enum(automodRuleKinds).parse(formData.get("kind"));
  const action = z.enum(automodRuleActions).parse(formData.get("action"));
  const wanted = text(formData, "enabled") === "true";
  const settings = await app.moderationSettings.getSettings(guildId);
  const rule = settings.automodRules.find((candidate) => candidate.kind === kind);

  if (rule?.action !== action) {
    await app.moderationSettings.setAutomodRuleAction(guildId, kind, action, actorId);
  }

  if (rule?.enabled !== wanted) {
    await app.moderationSettings.toggleAutomodRule(guildId, kind, actorId);
  }

  const constraints = getAutomodThresholdConstraints(kind);

  try {
    if (rule !== undefined && constraints.length > 0) {
      const threshold = { ...rule.threshold };

      for (const constraint of constraints) {
        const value = Number(text(formData, constraint.field));
        // A field the rule uses always needs a number; an empty input falls back to the minimum.
        threshold[constraint.field] = Number.isFinite(value)
          ? value
          : (rule.threshold[constraint.field] ?? constraint.minimum);
      }

      if (
        constraints.some(
          (constraint) => threshold[constraint.field] !== rule.threshold[constraint.field],
        )
      ) {
        await app.moderationSettings.setAutomodRuleThreshold(guildId, kind, threshold, actorId);
      }
    }

    const timeoutMinutes = Number(text(formData, "timeoutMinutes"));

    if (
      rule !== undefined &&
      Number.isFinite(timeoutMinutes) &&
      timeoutMinutes * 60 !== rule.timeoutSeconds
    ) {
      await app.moderationSettings.setAutomodRuleTimeout(
        guildId,
        kind,
        Math.round(timeoutMinutes * 60),
        actorId,
      );
    }
  } catch (error) {
    if (error instanceof AutomodThresholdInputError) {
      await app.tasks.enqueue("settings-changed", guildId, { module: "moderation" });
      done(guildId, "/moderation", "invalid");
    }

    throw error;
  }

  await app.tasks.enqueue("settings-changed", guildId, { module: "moderation" });

  done(guildId, "/moderation", "saved");
}

export async function setExemption(formData: FormData): Promise<void> {
  const { actorId, guildId, services: app } = await authorize(formData);
  const kind = z.enum(["channel", "role"]).parse(formData.get("kind"));
  const rawTargetId = snowflake.parse(formData.get("targetId"));
  const targetId =
    kind === "channel"
      ? await requireChannel(guildId, rawTargetId, [channelTypes.text, channelTypes.voice])
      : await requireRole(guildId, rawTargetId);
  const wanted = text(formData, "exempt") === "true";
  const settings = await app.moderationSettings.getSettings(guildId);
  const current = (
    kind === "channel" ? settings.exemptChannelIds : settings.exemptRoleIds
  ).includes(targetId);

  if (current === wanted) {
    await app.tasks.enqueue("settings-changed", guildId, { module: "moderation" });
    done(guildId, "/moderation", "saved");
  }

  const result =
    kind === "channel"
      ? await app.moderationSettings.toggleExemptChannel(guildId, targetId, actorId)
      : await app.moderationSettings.toggleExemptRole(guildId, targetId, actorId);
  await app.tasks.enqueue("settings-changed", guildId, { module: "moderation" });
  done(guildId, "/moderation", result === "limit-reached" ? "limit-reached" : "saved");
}

export async function saveVoiceLobby(formData: FormData): Promise<void> {
  const { actorId, guildId, services: app } = await authorize(formData);
  const categoryId = text(formData, "categoryId");

  try {
    const result = await app.voiceRooms.saveLobby(
      {
        categoryId:
          categoryId === ""
            ? null
            : await requireChannel(guildId, categoryId, [channelTypes.category]),
        channelId: await requireChannel(guildId, text(formData, "channelId"), [channelTypes.voice]),
        createdAt: new Date(),
        createdBy: actorId,
        guildId,
        nameTemplate: validateNameTemplate(text(formData, "nameTemplate")),
        userLimit: validateUserLimit(Number(text(formData, "userLimit") || "0")),
      },
      maximumLobbiesPerGuild,
    );
    await app.tasks.enqueue("settings-changed", guildId, { module: "voice-rooms" });
    done(guildId, "/voice-rooms", result === "limit-reached" ? "limit-reached" : "saved");
  } catch (error) {
    if (error instanceof VoiceRoomInputError) {
      await app.tasks.enqueue("settings-changed", guildId, { module: "voice-rooms" });
      done(guildId, "/voice-rooms", "invalid");
    }

    throw error;
  }
}

export async function removeVoiceLobby(formData: FormData): Promise<void> {
  const { guildId, services: app } = await authorize(formData);
  await app.voiceRooms.removeLobby(guildId, snowflake.parse(formData.get("channelId")));
  await app.tasks.enqueue("settings-changed", guildId, { module: "voice-rooms" });
  done(guildId, "/voice-rooms", "saved");
}

export async function saveMusicSettings(formData: FormData): Promise<void> {
  const { actorId, guildId, services: app } = await authorize(formData);
  const djRoleId = text(formData, "djRoleId");

  try {
    await app.musicSettings.update(
      guildId,
      {
        defaultVolume: Number(text(formData, "defaultVolume")),
        djRoleId: djRoleId === "" ? null : await requireRole(guildId, djRoleId),
      },
      actorId,
    );
    await app.tasks.enqueue("settings-changed", guildId, { module: "music" });
    done(guildId, "/music", "saved");
  } catch (error) {
    if (error instanceof MusicSettingsInputError) {
      await app.tasks.enqueue("settings-changed", guildId, { module: "music" });
      done(guildId, "/music", "invalid");
    }

    throw error;
  }
}
