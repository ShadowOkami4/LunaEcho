# Product specification

Status: product plan 0.1, pre-release. This document is the written form of roadmap phase 0 and the
reference for naming in code. Where it disagrees with the public product page, the product page
wins and this file is corrected.

## Principles

- **Open source first.** The complete feature set is in the public repository.
- **Modular by design.** Every major capability is a module a server can switch on or off.
- **One shared codebase.** Self-Hosted, Cloud, and Custom are deployment choices, not separate
  bots. A fix in a module improves LunaEcho for everyone.
- **No made-up prices or limits.** Custom prices, member brackets, and Cloud limits are set only
  after real measurements of music, database, storage, bandwidth, backup, and support costs.

## Ways to run LunaEcho

| Decision              | Self-Hosted | Cloud                     | Custom                         |
| --------------------- | ----------- | ------------------------- | ------------------------------ |
| Price                 | Free        | Free                      | Paid, based on server size     |
| Hosted by             | You         | LunaEcho                  | LunaEcho                       |
| Bot application       | Yours       | LunaEcho's                | Yours                          |
| Bot token             | Yours       | LunaEcho's                | Yours                          |
| Feature restrictions  | None\*      | Reasonable service limits | No normal Cloud restrictions\* |
| Updates & maintenance | You         | LunaEcho                  | LunaEcho                       |
| Branding              | Yours       | LunaEcho                  | Yours                          |

\* Subject to technical, Discord API, third-party API, and fair-use constraints rather than
artificial feature locks.

Names used in code:

| Product name | Runtime mode   | Plan          |
| ------------ | -------------- | ------------- |
| Self-Hosted  | `self-hosted`  | `self-hosted` |
| Cloud        | `cloud-shared` | `cloud`       |
| Custom       | `cloud-custom` | `custom`      |

The runtime mode says who hosts the process and which bot identity it uses. The plan says what one
server may use. Custom server-size brackets belong inside billing; they are not separate plans.

## Version 1 modules

| #   | Module               | Id                     | Scope                                                                              |
| --- | -------------------- | ---------------------- | ---------------------------------------------------------------------------------- |
| 01  | Moderation & Safety  | `moderation`           | Warnings, timeouts, kicks, bans, cleanup, moderation cases, AutoMod, and anti-spam |
| 02  | Welcome & Onboarding | `onboarding`           | Welcome and goodbye messages, autoroles, verification, and onboarding flows        |
| 03  | Roles                | `roles`                | Reaction, button, select, persistent, and self-service role menus                  |
| 04  | Support & Tickets    | `tickets`              | Panels, categories, staff assignment, transcripts, claims, and ticket logs         |
| 05  | Levels & Rewards     | `levels`               | XP, ranks, leaderboards, rewards, voice XP, and exclusions                         |
| 06  | Voice Rooms          | `voice-rooms`          | Join-to-create rooms, ownership, limits, locking, names, and permissions           |
| 07  | Logs                 | `logs`                 | Moderation, member, message, channel, role, voice, and configuration events        |
| 08  | Music                | `music`                | Playback, queues, permissions, playlists, and voice controls                       |
| 09  | Automation           | `automation`           | Flexible trigger, condition, and action workflows                                  |
| 10  | Social Notifications | `social-notifications` | YouTube, Twitch, and potentially other service notifications                       |
| 11  | Utilities            | `utilities`            | Server and user information, polls, reminders, and general Discord tools           |

New modules can be added later without turning LunaEcho into separate bots.

### Module behavior

- A server should not receive a hundred commands simply because LunaEcho supports them.
- Disabling a module stops its commands, events, and workers.
- Disabling a module does not delete its settings; enabling it again restores them.

## Platform requirements

### Custom token security

A bot token is a password. Custom requires a real secrets system from day one:

- customer tokens are encrypted at rest and exposed only to the service that opens the Discord
  connection
- never included in logs, analytics, or support tickets
- never returned to the browser after submission
- excluded from normal database exports
- masked in the dashboard and replaced, never revealed

### Two permission layers

Discord permissions control what the bot can do. LunaEcho dashboard permissions control what staff
can configure, inspect, or purchase: managing moderation or tickets, viewing logs and analytics,
editing automations and modules, and managing hosting, billing, and support access.

### Support boundaries

Responsibility follows hosting. Self-Hosted receives documentation and community support, Cloud
receives best-effort support, and Custom adds managed support for LunaEcho infrastructure,
deployment, updates, and billing. There is no promise of 24/7 support at launch and no promise to
repair third-party VPS setups.

### Planned Custom onboarding

Choose Custom → sign in with Discord → select your server → create an application → submit and
verify the bot token → invite your custom bot → configure modules → start the managed instance.

## Intentionally open

Exact pricing, member brackets, Cloud limits, large-scale orchestration, AI features, and enterprise
features stay undecided until the platform provides evidence for those decisions.
