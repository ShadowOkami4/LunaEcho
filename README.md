# LunaEcho

**One bot. Every community tool. Your way.**

LunaEcho is a modular, all-in-one, open-source Discord community platform. A server enables only the
modules it needs. The same codebase runs in three ways:

| Mode        | Hosted by | Bot identity | Status                                       |
| ----------- | --------- | ------------ | -------------------------------------------- |
| Self-Hosted | You       | Yours        | In development; the only mode this repo runs |
| Cloud       | LunaEcho  | LunaEcho's   | Planned                                      |
| Custom      | LunaEcho  | Yours        | Planned                                      |

> **Pre-release.** LunaEcho has no public release and is not accepting public servers. The roadmap
> in [docs/roadmap.md](docs/roadmap.md) describes order, not dates.

## What works today

- Discord.js gateway, typed command registry, and one central interaction dispatcher
- Components V2 panels for every user-facing response
- `/status` for runtime diagnostics
- `/modules list | enable | disable` to switch modules per server without losing their settings;
  only essential modules (Moderation & Safety, Logs) are on by default
- Bounded memory: the discord.js message cache is off and every cache has a size limit, which cut a
  busy test guild from 23.6 MB to 0.13 MB ([measurements](docs/resource-measurements.md),
  reproducible with `npm run bench`)
- **Moderation & Safety**, the first module:
  - `/moderation` opens the administrator-only settings dashboard
  - `/moderate` runs warnings, timeouts, kicks, bans, unbans, and message purges, and shows the
    case history
  - AutoMod with Off, Relaxed, Balanced, and Strict profiles, ten tunable rules, a banned-word
    filter, and channel and role exemptions
- **Voice Rooms**: join-to-create lobbies (`/voice-rooms`) and owner controls (`/room rename, limit,
lock, hide, permit, reject, kick, transfer, claim, info`); empty rooms are deleted, also after
  downtime
- **Music** through a Lavalink audio node: `/music play, skip, stop, pause, resume, volume, loop,
shuffle, remove, queue, settings` with an optional DJ role ([docs/music.md](docs/music.md))
- **Welcome & Onboarding**: welcome and goodbye messages, a welcome DM, autoroles, and a
  verification button
- **Roles**: self-assignable role menus with buttons or a drop-down
- **Support & Tickets**: private ticket threads with claim, close, and text transcripts
- **Levels & Rewards**: message and voice XP, role rewards, `/rank` and leaderboard
- **Logs**: messages, members, server changes, voice, and moderation cases per channel
- **Automation**: rules with keyword, join, or schedule triggers, conditions, and actions
- **Social Notifications**: new YouTube videos (RSS, no key) and Twitch streams (optional app keys)
- **Utilities**: `/remind` and `/info`
- **Dashboard** with Discord login and a settings page for every module
  ([docs/dashboard.md](docs/dashboard.md))
- Stress, soak, and live load tests ([docs/testing.md](docs/testing.md))
- PostgreSQL storage with versioned migrations applied at startup
- Entitlements and plans resolved in one place, with a private-provider boundary for managed modes

All eleven version 1 modules are implemented. Only Moderation & Safety and Logs are on by default;
everything else is switched on per server in the dashboard. Slash commands are kept to six
(`/info`, `/moderate`, `/music`, `/rank`, `/remind`, `/room`); everything else is configured in the
dashboard or used through buttons on posted panels.

## Repository layout

```text
apps/
  bot/            the Discord bot process: Discord adapters, commands, stress tests
  dashboard/      the Next.js web dashboard
packages/
  core/           module catalog, runtime modes, entitlements and plans, logging, caches
  db/             PostgreSQL schema, generated migrations, connection, test database
  modules/        Discord-independent module logic and storage, shared by bot and dashboard
lavalink/         configuration for the Lavalink audio node
docs/             specification, architecture, limits, testing, music, dashboard, roadmap
```

See [docs/architecture.md](docs/architecture.md) for how the pieces fit together.

## Local development

Requirements:

- Node.js 24 or newer
- PostgreSQL 15 or newer (the included Docker Compose file starts one)
- a Discord application and bot token
- for music: a Lavalink 4 node, which needs Java 17 or Docker ([docs/music.md](docs/music.md))

```sh
npm install
cp .env.example .env        # PowerShell: Copy-Item .env.example .env
docker compose up -d        # starts PostgreSQL and Lavalink
npm run dev                 # the bot
npm run dashboard           # the dashboard on http://localhost:3000 (after `npm run build`)
```

`.env` lives in the repository root. The bot applies pending database migrations when it starts.

The Discord application needs the **Message Content Intent**. The bot role needs **View Channels**,
**Read Message History**, **Manage Messages**, **Moderate Members**, **Kick Members**, and **Ban
Members** for moderation, **Manage Channels** and **Move Members** for voice rooms, and **Connect**
and **Speak** for music. It must sit above the members it moderates.

> `npm run commands:deploy -- --global` replaces the application's global commands. When `.env`
> holds the token of a bot that is already public, deploy to the test server only.

Run the complete quality gate before committing:

```sh
npm run check
```

It checks formatting, lints, type-checks, runs every test, and builds every package. Tests need no
database server: repository tests run the real migrations and SQL against an in-process PostgreSQL.

### Slash commands

Command deployment is separate from bot startup, so a restart never overwrites commands.

```sh
npm run commands:deploy              # to DISCORD_DEVELOPMENT_GUILD_ID, updates immediately
npm run commands:deploy -- --global  # replaces the global command set
```

### Database changes

Edit `packages/db/src/schema.ts`, then generate a migration and commit it together with the schema:

```sh
npm run db:generate
```

### Discord smoke test

With `DISCORD_DEVELOPMENT_GUILD_ID` set, `npm run smoke:discord` sends, edits, and reacts to one
clearly marked panel in the development server to verify the live connection and permissions.

## Security boundary

This repository only ever starts in Self-Hosted mode. Cloud and Custom verify subscriptions through
an `EntitlementProvider` implemented in private infrastructure code, and there is deliberately no
environment switch that unlocks a managed plan.

Never commit a Discord token, database password, billing secret, or provider credential. Logs redact
token and connection-string fields and never contain message content or matched banned words.

## License and contributions

LunaEcho is licensed under the [GNU Affero General Public License v3.0](LICENSE). Anyone may run,
modify, and host it; whoever offers a modified version as a network service must publish those
modifications under the same license.

External code contributions are not being accepted yet, because a contributor agreement has to be in
place first. Bug reports and ideas are welcome once the repository is public.
