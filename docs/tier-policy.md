# Tier policy

Commands and event handlers must use `EntitlementService`; they must not inspect billing state or
plan names directly. The values live in `packages/core/src/entitlements/plan-catalog.ts`.

A quota exists only for a resource whose cost has been measured in
[resource-measurements.md](resource-measurements.md). Modules that are not built yet have no quotas;
each module adds its own when it is implemented and measured.

## Modules per plan

| Module               | Self-Hosted | Cloud | Custom |
| -------------------- | ----------: | ----: | -----: |
| Moderation & Safety  |         Yes |   Yes |    Yes |
| Welcome & Onboarding |         Yes |   Yes |    Yes |
| Roles                |         Yes |   Yes |    Yes |
| Support & Tickets    |         Yes |   Yes |    Yes |
| Levels & Rewards     |         Yes |   Yes |    Yes |
| Voice Rooms          |         Yes |   Yes |    Yes |
| Logs                 |         Yes |   Yes |    Yes |
| Utilities            |         Yes |   Yes |    Yes |
| Music                |         Yes |    No |    Yes |
| Automation           |         Yes |    No |    Yes |
| Social Notifications |         Yes |    No |    Yes |

Withholding Music, Automation, and Social Notifications from Cloud is a provisional product decision:
those modules are not built, and their cost per server is the least predictable.

## Quotas per server

| Quota                   | Self-Hosted         |  Cloud |  Custom |
| ----------------------- | ------------------- | -----: | ------: |
| Stored moderation cases | Operator controlled | 12,000 | 120,000 |

When a guild reaches its limit, each new case deletes the oldest one. Case numbers keep counting up
and are never reused.

The numbers are a **storage budget per server divided by the measured cost of one case** (830 bytes,
the upper bound with a 400-character reason), rounded down to whole thousands:

| Plan   | Budget for moderation history |   Cases |
| ------ | ----------------------------- | ------: |
| Cloud  | 10 MB                         |  12,000 |
| Custom | 100 MB                        | 120,000 |

The byte cost is measured; **the budgets are assumptions** that have to be checked against real
hosting prices before the managed service launches. Changing a budget in `plan-catalog.ts`
recalculates the limit. For scale: 12,000 cases are several years of history for a typical server,
or about six minutes of an unmitigated raid by 500 accounts (roughly 2,000 AutoMod cases per
minute). A raid can therefore push older history out; that is the intended trade-off for a free
plan.

## Technical limits for every plan

These protect the process itself and apply equally to Self-Hosted, Cloud, and Custom:

| Limit                         | Value                          | Reason                                            |
| ----------------------------- | ------------------------------ | ------------------------------------------------- |
| Banned words per server       | 100                            | 3 µs per message; 1,000 words would cost 35× more |
| AutoMod exemptions per type   | 25                             | Discord select menus offer at most 25 options     |
| Cached messages               | none                           | LunaEcho never reads cached messages              |
| Cached members per server     | 100                            | Only needed while one event is handled            |
| Cached moderation settings    | 2,000 servers, 30 seconds      | At most 57 MB, typically about 4 MB               |
| Cached module switches        | 10,000 servers, 30 seconds     | About 2.5 MB                                      |
| Voice room lobbies per server | 10                             | Keeps setup readable                              |
| Open voice rooms per server   | 200                            | Discord allows 500 channels per server            |
| New room per member           | one per 10 seconds             | Stops join/leave spam from churning channels      |
| Room renames                  | two per room per 10 minutes    | Discord's own limit; more would queue for minutes |
| Songs per queue               | 1,000                          | About 1 KB each                                   |
| Music sessions per process    | 200 (`MUSIC_MAXIMUM_SESSIONS`) | Protects the Lavalink node                        |

Voice rooms and music have no plan quotas yet. The stress test shows that a room costs LunaEcho
almost nothing; its real cost is Discord API calls and channel slots, which the limits above
already bound. Music's cost sits in Lavalink, which has not been measured yet, and Music is not
part of the provisional Cloud plan.

## Custom size readings

Custom is paid per bot and by size. Once a UTC day the orchestrator asks Discord, with each
running Custom bot's own token, for the servers the bot is in and their approximate member counts,
and stores the sum in `custom_bot_usage`. A bot's size is the **30-day average** of those readings;
days without a reading (the bot was stopped or not yet added) count as zero. Averaging keeps a raid
or a short spike from changing the price. A member in two servers of the same bot counts twice:
removing duplicates would need member lists, which LunaEcho does not collect for billing.

The billing service turns these sizes into a price outside this repository (see Managed
verification below); the dashboard shows each bot's latest reading and the owner's 30-day total.

## Managed verification

Managed subscription verification is intentionally not implemented in the public repository. A
private adapter resolves an entitlement snapshot from trusted billing data. The public bot depends
only on the provider interface and stays unaware of billing vendors, secrets, and algorithms.
