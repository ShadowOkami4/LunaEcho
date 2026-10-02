import type { IconName } from "@/components/icon";

export type Section = Readonly<{
  description: string;
  /** Path below /servers/[guildId]; "" is the overview. */
  href: string;
  icon: IconName;
  label: string;
  /** The catalog module this page configures, if any. */
  moduleId?: string;
}>;

export type SectionGroup = Readonly<{ label: string; sections: readonly Section[] }>;

/** The server settings, grouped the way the navigation drawer shows them. */
export const sectionGroups: readonly SectionGroup[] = [
  {
    label: "Overview",
    sections: [
      {
        description: "Choose which modules run on this server.",
        href: "",
        icon: "dashboard",
        label: "Modules",
      },
    ],
  },
  {
    label: "Safety",
    sections: [
      {
        description: "AutoMod rules, banned words, exemptions, and recent cases.",
        href: "/moderation",
        icon: "shield",
        label: "Moderation",
        moduleId: "moderation",
      },
      {
        description:
          "Where LunaEcho records messages, members, server changes, and voice activity.",
        href: "/logs",
        icon: "receiptLong",
        label: "Logs",
        moduleId: "logs",
      },
    ],
  },
  {
    label: "Community",
    sections: [
      {
        description: "Greetings, autoroles, and member verification.",
        href: "/welcome",
        icon: "wavingHand",
        label: "Welcome",
        moduleId: "onboarding",
      },
      {
        description: "Menus that let members pick their own roles.",
        href: "/roles",
        icon: "label",
        label: "Roles",
        moduleId: "roles",
      },
      {
        description: "Private support threads between members and your team.",
        href: "/tickets",
        icon: "confirmationNumber",
        label: "Tickets",
        moduleId: "tickets",
      },
      {
        description: "Experience points, role rewards, and the leaderboard.",
        href: "/levels",
        icon: "militaryTech",
        label: "Levels",
        moduleId: "levels",
      },
    ],
  },
  {
    label: "Voice",
    sections: [
      {
        description: "Lobbies that open a private voice room for each member.",
        href: "/voice-rooms",
        icon: "headphones",
        label: "Voice Rooms",
        moduleId: "voice-rooms",
      },
      {
        description: "Playback permissions and the default volume.",
        href: "/music",
        icon: "musicNote",
        label: "Music",
        moduleId: "music",
      },
    ],
  },
  {
    label: "Automation",
    sections: [
      {
        description: "Rules that act on keywords, new members, or a schedule.",
        href: "/automation",
        icon: "bolt",
        label: "Automation",
        moduleId: "automation",
      },
      {
        description: "Announcements for new YouTube videos and Twitch streams.",
        href: "/social",
        icon: "campaign",
        label: "Social",
        moduleId: "social-notifications",
      },
    ],
  },
];

export const sections: readonly Section[] = sectionGroups.flatMap((group) => group.sections);

/** Icons for catalog modules, including those without their own settings page. */
export const moduleIcons: Readonly<Record<string, IconName>> = {
  ...Object.fromEntries(
    sections.flatMap((section) =>
      section.moduleId === undefined ? [] : [[section.moduleId, section.icon]],
    ),
  ),
  utilities: "handyman",
};
