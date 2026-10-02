# Roadmap

The roadmap describes order, not dates. Billing comes late, after the core community tools and the
managed infrastructure have proven themselves. Versions follow semantic versioning from 0.1.0.

| Phase | Goal                           | State       |
| ----: | ------------------------------ | ----------- |
|     0 | Specification                  | In progress |
|     1 | Core platform                  | In progress |
|     2 | Moderation and logging         | Done        |
|     3 | Roles, onboarding, and tickets | Done        |
|     4 | Levels and voice rooms         | Done        |
|     5 | Dashboard                      | In progress |
|     6 | Automation engine              | In progress |
|     7 | Isolated music service         | In progress |
|     8 | Self-Hosted Alpha              | Not started |
|     9 | Cloud Alpha                    | Not started |
|    10 | Custom Alpha                   | Not started |
|    11 | Public Beta                    | Not started |
|    12 | Stable public release (1.0)    | Not started |

Voice rooms, music, and the dashboard were pulled forward so they can be load-tested early.

## Where each open phase stands

**Phase 0, specification.** [product-spec.md](product-spec.md), [architecture.md](architecture.md),
[tier-policy.md](tier-policy.md), [music.md](music.md), [dashboard.md](dashboard.md), and
[testing.md](testing.md) exist. Still open: a written specification per module before it is built.

**Phase 1, core platform.** Done: workspace, configuration, logging, PostgreSQL with locked
migrations, gateway events, command routing, entitlements, module catalog, per-server switches,
bounded caches, per-guild serialization, and stress, soak, and live test tooling. Still open:
Redis and BullMQ, sharding, per-server command registration, and container images.

**Phases 2 to 4.** Moderation & Safety, Logs, Welcome & Onboarding, Roles, Support & Tickets,
Levels & Rewards, Voice Rooms, Utilities, and Social Notifications are implemented. Still open:
live tests on the test server for the newest modules, and load tests for tickets and role menus.

**Phase 6, automation engine.** Rules with three triggers (keyword, join, schedule), channel and
role conditions, and five actions run today. Still open: more triggers (reactions, role changes),
and a per-rule run history in the dashboard.

**Phase 5, dashboard.** Discord login, server selection, module switches, and settings pages for
every module; the bot reloads changed settings within seconds. Still open: live statistics and an
audit history of dashboard changes.

**Phase 7, isolated music service.** Music runs through Lavalink in its own process. Still open:
measuring Lavalink's capacity per core, several nodes, and resuming queues after a restart.
