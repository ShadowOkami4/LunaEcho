# Architecture

## Workspace

LunaEcho is an npm workspace written in strict TypeScript (ES modules, Node.js 24+).

| Package               | Purpose                                                                                   | May depend on     |
| --------------------- | ----------------------------------------------------------------------------------------- | ----------------- |
| `@lunaecho/core`      | Module catalog, runtime modes, entitlements and plans, logging, caches, locks             | nothing           |
| `@lunaecho/db`        | PostgreSQL schema (Drizzle), generated migrations, connection, test database              | core              |
| `@lunaecho/modules`   | Module logic and storage without Discord: moderation, voice rooms, music, module switches | core, db          |
| `@lunaecho/bot`       | The Discord bot: gateway, commands, Discord and Lavalink adapters                         | core, db, modules |
| `@lunaecho/dashboard` | The Next.js dashboard                                                                     | core, db, modules |

Everything that decides _what_ happens lives in `@lunaecho/modules` and talks to the outside world
through small interfaces. The bot implements them with discord.js and Lavalink; tests and the load
simulation implement them in memory. Because of that, the dashboard applies exactly the same rules
and limits as the bot, and the stress test exercises the production code.

| Interface           | Bot implementation                | Simulation               |
| ------------------- | --------------------------------- | ------------------------ |
| `VoiceRoomPlatform` | `DiscordVoiceRoomPlatform`        | `SimulatedVoicePlatform` |
| `MusicBackend`      | `LavalinkMusicBackend`            | `SimulatedMusicBackend`  |
| `*Repository`       | `Drizzle…Repository` (PostgreSQL) | `InMemory…Repository`    |

During development, tests, and type-checking, packages resolve each other's TypeScript sources
through the `development` export condition. `npm run build` compiles every package to `dist`.

## The bot process

```text
apps/bot/src/
  app/                  lifecycle (LunaApplication) and dependency composition
  config/               validated environment configuration
  infrastructure/
    discord/            client, gateway events, command registry, interaction dispatcher, panels
  modules/
    moderation/         message filters, AutoMod detector, Discord notifications, commands
    music/              Lavalink backend, listener tracking, /music
    system/             /status and /modules
    voice-rooms/        Discord platform adapter, voice events, /voice-rooms and /room
  scripts/              command deployment and the Discord smoke test
apps/bot/bench/         micro-benchmarks
apps/bot/stress/        stress, soak, and live load tests
```

`create-application.ts` is the only place that wires concrete classes together. Every interaction
passes through `InteractionDispatcher`, which enforces in order: server-only commands, the member's
Discord permissions, the plan (entitlements), and whether the module is enabled in that server.
Gateway events (messages, voice states, deleted channels, ready) are fanned out by `DiscordGateway`,
which isolates handler failures from each other.

## Modules and plans

`@lunaecho/core` holds the catalog of the eleven version 1 modules. Each has a status:

- `available`: implemented and can be switched on or off per server
- `planned`: part of the version 1 scope, not implemented, cannot be enabled

Only essential modules (`enabledByDefault`: Moderation & Safety and Logs) run in a new server.
Every other module stays off until an administrator enables it with `/modules` or the dashboard.

Each module is also one entitlement capability. A command declares `requiredCapability`, and that
field drives both checks: the plan must include the module, and the server must have it enabled.
`ModuleSettingsService` stores only explicit switches in `guild_modules`, so disabling a module
never touches that module's settings. Voice rooms keep deleting empty rooms while their module is
off, so switching it off never leaves abandoned channels behind.

## Concurrency

All work for one server runs in order through `KeyedMutex`, while different servers run in
parallel. That prevents, for example, a member hopping between channels from opening two rooms,
or two `/music play` commands from connecting twice. Server-wide limits that span servers, such as
the number of music sessions, reserve their slot before the slow network call; the stress test
found that checking only finished sessions let concurrent servers overshoot the limit.

## Database

PostgreSQL is the only supported database. The schema is defined with Drizzle in
`packages/db/src/schema.ts`; `npm run db:generate` turns changes into SQL files under
`packages/db/drizzle`, which are committed. The bot applies them at startup under a PostgreSQL
advisory lock; `npm run db:migrate` does the same without starting the bot. The dashboard never
migrates.

Repositories receive a driver-independent `LunaDatabase` handle. Production connects through the
`pg` pool; tests use PGlite, an in-process PostgreSQL, with the same migrations. Multi-step changes
run in a transaction that first locks the guild's row, so per-guild limits hold under concurrent
requests. Timestamps are `timestamptz`, Discord ids are `text`.

## Memory and limits

Every in-process cache is bounded; [resource-measurements.md](resource-measurements.md) records what
each item costs and [tier-policy.md](tier-policy.md) the resulting limits. `createDiscordCacheOptions`
disables the discord.js message cache, keeps at most 100 members per guild, and sweeps users no
guild references. Settings caches use `ExpiringCache`, a fixed lifetime plus a maximum size. Voice
occupancy is read from voice states, never from the size-limited member cache.

## Not built yet

- Redis and BullMQ (queues and cross-process cache invalidation). Caches are per process with a
  30–60 second lifetime, so dashboard changes reach the bot after at most that long, and only one
  bot process may run per token.
- Sharding across several bot processes
- S3-compatible object storage
- A Docker image for the bot and dashboard; `docker-compose.yml` starts PostgreSQL and Lavalink
- Per-server slash command registration; a disabled module's commands stay visible and answer with
  a "module disabled" notice
- The secrets system and encrypted token storage required by Custom
