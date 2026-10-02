export const moduleIds = [
  "moderation",
  "onboarding",
  "roles",
  "tickets",
  "levels",
  "voice-rooms",
  "logs",
  "music",
  "automation",
  "social-notifications",
  "utilities",
] as const;

export type ModuleId = (typeof moduleIds)[number];

/** A planned module is part of the version 1 scope but has no implementation yet. */
export type ModuleStatus = "available" | "planned";

export type ModuleDescriptor = Readonly<{
  description: string;
  displayName: string;
  /**
   * Only essential modules run without being switched on. Everything else stays quiet until an
   * administrator enables it, so a new server is not flooded with features it did not ask for.
   */
  enabledByDefault: boolean;
  id: ModuleId;
  status: ModuleStatus;
}>;

export const moduleCatalog = [
  {
    description:
      "Warnings, timeouts, kicks, bans, cleanup, moderation cases, AutoMod, and anti-spam.",
    displayName: "Moderation & Safety",
    enabledByDefault: true,
    id: "moderation",
    status: "available",
  },
  {
    description: "Welcome and goodbye messages, autoroles, verification, and onboarding flows.",
    displayName: "Welcome & Onboarding",
    enabledByDefault: false,
    id: "onboarding",
    status: "available",
  },
  {
    description: "Reaction, button, select, persistent, and self-service role menus.",
    displayName: "Roles",
    enabledByDefault: false,
    id: "roles",
    status: "available",
  },
  {
    description: "Panels, categories, staff assignment, transcripts, claims, and ticket logs.",
    displayName: "Support & Tickets",
    enabledByDefault: false,
    id: "tickets",
    status: "available",
  },
  {
    description: "XP, ranks, leaderboards, rewards, voice XP, and exclusions.",
    displayName: "Levels & Rewards",
    enabledByDefault: false,
    id: "levels",
    status: "available",
  },
  {
    description: "Join-to-create rooms, ownership, limits, locking, names, and permissions.",
    displayName: "Voice Rooms",
    enabledByDefault: false,
    id: "voice-rooms",
    status: "available",
  },
  {
    description: "Moderation, member, message, channel, role, voice, and configuration events.",
    displayName: "Logs",
    enabledByDefault: true,
    id: "logs",
    status: "available",
  },
  {
    description: "Playback, queues, permissions, playlists, and voice controls.",
    displayName: "Music",
    enabledByDefault: false,
    id: "music",
    status: "available",
  },
  {
    description: "Flexible trigger, condition, and action workflows.",
    displayName: "Automation",
    enabledByDefault: false,
    id: "automation",
    status: "available",
  },
  {
    description: "YouTube, Twitch, and potentially other service notifications.",
    displayName: "Social Notifications",
    enabledByDefault: false,
    id: "social-notifications",
    status: "available",
  },
  {
    description: "Server and user information, polls, reminders, and general Discord tools.",
    displayName: "Utilities",
    enabledByDefault: false,
    id: "utilities",
    status: "available",
  },
] as const satisfies readonly ModuleDescriptor[];

export function isModuleId(value: string): value is ModuleId {
  return moduleIds.some((moduleId) => moduleId === value);
}

export function getModuleDescriptor(moduleId: ModuleId): ModuleDescriptor {
  const descriptor = moduleCatalog.find((candidate) => candidate.id === moduleId);

  if (descriptor === undefined) {
    throw new TypeError(`Module '${moduleId}' is missing from the module catalog`);
  }

  return descriptor;
}
