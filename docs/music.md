# Music

The Music module plays audio through [Lavalink](https://lavalink.dev), a separate Java server that
searches sources, decodes audio, and streams it to Discord. The bot only manages queues and voice
connections, so heavy music load never blocks moderation or voice rooms, and Lavalink can run on
another machine.

Music is off until an administrator enables it with `/modules enable music` or in the dashboard,
and it needs a Lavalink node. Without one, `/music` answers that music is unavailable.

## Running Lavalink

Lavalink 4 needs **Java 17 or newer**. `lavalink/application.yml` holds the configuration.

First download the plugins (the YouTube source) into `lavalink/plugins`. Lavalink loads every jar
there, so it does not depend on Lavalink's own plugin repository, which was unreachable when this
was set up:

```sh
npm run lavalink:plugins
```

With Docker (starts PostgreSQL too):

```sh
docker compose up -d
```

Without Docker, run `npm run lavalink:plugins`, download `Lavalink.jar` 4.2.2 from the
[releases page](https://github.com/lavalink-devs/Lavalink/releases) into `lavalink/` and run:

```sh
cd lavalink
java -Xmx1G -jar Lavalink.jar
```

Then set in `.env`:

```sh
LAVALINK_URL=localhost:2333
LAVALINK_PASSWORD=youshallnotpass   # the value of LAVALINK_PASSWORD for Lavalink
MUSIC_SEARCH_SOURCES=ytsearch,scsearch
```

Plain-text queries try the search prefixes in order until one finds something; links go straight
to whichever source recognises them.

## Keeping YouTube working

YouTube changes its player often, and the YouTube plugin cannot always follow on its own. Two
measures keep playback working; both were needed when this was tested on 1 October 2026:

- **A current plugin build.** `scripts/fetch-lavalink-plugins.mjs` pins a snapshot build of
  `youtube-source`, because release 1.18.2 no longer played any video. Move back to a release once
  one includes the fixes.
- **The `yt-cipher` service** in `docker-compose.yml` deciphers YouTube's player signatures for the
  plugin (`plugins.youtube.remoteCipher` in `lavalink/application.yml`). It is reachable only inside
  the Docker network and protected by `YT_CIPHER_TOKEN`.

The client order in `application.yml` starts with `TVHTML5_SIMPLY`, which plays without a login.
OAuth logins are deliberately not used: the plugin warns that they can get the Google account
terminated.

Search results can work while playback is blocked, so check with real audio:

```sh
LOAD_BOT_TOKENS=<helper bot> LIVE_VOICE_CHANNEL_ID=<voice channel> npm run live:music -- --sources ytsearch,scsearch
```

It reports `PLAYS` only when the playback position actually advances. When songs cannot be played,
LunaEcho now says so in the channel where `/music play` was used, and stops after five failures in
a row instead of failing silently.

## Choosing sources

Sources are enabled in `lavalink/application.yml`, and the bot's `MUSIC_SEARCH_SOURCES` decides
which searches it tries.

| Source             | Where it is enabled                     | Search prefix |
| ------------------ | --------------------------------------- | ------------- |
| YouTube            | `lavalink/plugins/youtube-plugin-*.jar` | `ytsearch`    |
| SoundCloud         | `sources.soundcloud`                    | `scsearch`    |
| Bandcamp           | `sources.bandcamp`                      | `bcsearch`    |
| Twitch, Vimeo      | `sources.twitch`, `sources.vimeo`       | links only    |
| Direct audio links | `sources.http`                          | links only    |

**YouTube's terms of service do not allow streaming its audio through bots.** Self-hosters decide
for themselves. For Cloud and Custom, delete the YouTube plugin jar and set
`MUSIC_SEARCH_SOURCES=scsearch` before launch.

## Commands

`/music play | skip | stop | pause | resume | volume | loop | shuffle | remove | queue` and
`/music settings` for the DJ role and default volume (Manage Server). With a DJ role, only members
with that role or Manage Server can control playback; everyone can still add songs.

A player leaves its channel after two minutes without music or without listeners. Queues live in
memory and are lost when the bot restarts.

## Limits

| Limit                             | Default | Setting                  |
| --------------------------------- | ------: | ------------------------ |
| Songs in one queue                |   1,000 | technical maximum        |
| Simultaneous sessions per process |     200 | `MUSIC_MAXIMUM_SESSIONS` |
| Consecutive failed tracks         |       5 | the session then stops   |

The session limit protects the Lavalink node. Its real capacity depends on Lavalink's machine and
has not been measured yet; Lavalink's `/metrics` endpoint (Prometheus) is enabled for that.
