# Resource measurements

Limits in LunaEcho come from measured costs, not guesses. `npm run bench` reproduces every number
on this page (`apps/bot/bench/resource-usage.ts`). Rerun it and update this page whenever a module is
added or a hot path changes.

Measured on 30 September 2026 with Node.js 26.3 on x64 Windows. CPU times vary by roughly a factor of
two between runs on the same machine, so read them as orders of magnitude.

## Summary

| Rank | Consumer                         | Cost                                                                 | Limit                                                  |
| ---: | -------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------ |
|    1 | discord.js message cache         | 2.2 KB per message (6 KB at 4,000 characters), up to 200 per channel | Disabled; LunaEcho never reads it                      |
|    2 | discord.js member and user cache | 2.8 KB per message author, unbounded                                 | 100 members per guild, unreferenced users swept hourly |
|    3 | Stored moderation cases          | 381 to 827 bytes per case, unbounded                                 | Plan quota; see [tier-policy.md](tier-policy.md)       |
|    4 | Cached moderation settings       | 2 KB per guild, 28 KB with 100 banned words                          | 2,000 guilds, 30 seconds                               |
|    5 | Banned-word filter CPU           | Grows faster than linearly with the word count                       | 100 words per guild (unchanged)                        |

In one busy guild (10,000 messages from 5,000 authors over 50 channels) the process retained
**23.6 MB with the discord.js defaults and 0.13 MB with LunaEcho's cache limits**, a 99.5 % reduction.
LunaEcho's own state is small next to that: everything it caches for a guild is 2 to 28 KB.

## CPU per message

Banned-word filter, message without a match (the worst case, because every word is tested):

| Banned words | Typical message (67 characters) | Longest message (4,000 characters) |
| -----------: | ------------------------------: | ---------------------------------: |
|           10 |                          0.7 µs |                              21 µs |
|          100 |                            3 µs |                              69 µs |
|          500 |                           25 µs |                             373 µs |
|        1,000 |                          108 µs |                             757 µs |

From 100 to 1,000 words the cost per message grows about 35-fold for typical messages, while
100 words cost 3 µs. The existing maximum of 100 words per guild therefore stays for every plan: it
is cheap enough that no plan needs less, and raising it would cost disproportionately more.

AutoMod with all ten rules enabled costs 6 to 12 µs for a typical message and 50 to 100 µs for the
longest one. One core handles tens of thousands of messages per second, so AutoMod needs no plan
limit today.

## Memory

| Item                                              |   Retained heap |
| ------------------------------------------------- | --------------: |
| Guild with 50 channels and 30 roles (discord.js)  |           70 KB |
| Cached message, typical / 4,000 characters        |   2.2 KB / 6 KB |
| Cached user and guild member per message author   |          2.8 KB |
| Full default message cache, 50 channels × 200     |         21.8 MB |
| Cached moderation settings, 0 / 100 / 1,000 words | 2 / 28 / 266 KB |
| Cached module switches                            |       235 bytes |
| AutoMod activity window per active member         |          1.3 KB |

The guild structure itself is needed for permission checks and stays cached. AutoMod's activity
window was already bounded to 10,000 members (about 13 MB).

## Database storage

Bytes per row including indexes, measured in PostgreSQL's on-disk format:

| Item                                    |                Size |
| --------------------------------------- | ------------------: |
| Moderation case, AutoMod reason         |           381 bytes |
| Moderation case, 400-character reason   |           827 bytes |
| Banned word                             |           192 bytes |
| All ten AutoMod rules                   |    2.4 KB per guild |
| 25 exempt channels and 25 exempt roles  |    8.8 KB per guild |
| Moderation settings and a module switch | 778 bytes per guild |

Everything except moderation cases is capped per guild, so a fully configured guild needs at most
about 31 KB. Cases are the only table that grows without a bound: AutoMod can open one case per
member and rule every 15 seconds, so a raid of 500 accounts can add roughly 0.8 MB per minute.

## Not measured

Tickets, Levels, Voice Rooms, Logs, Music, Automation, Social Notifications, and the other planned
modules do not exist yet, so they have no measurements and no quotas. Music is expected to be the
most expensive module, because audio encoding and streaming cost CPU and bandwidth for as long as a
voice connection is open. That expectation still has to be confirmed by measurement.

## Not verified against Discord

The cache limits were tested with the gateway payload format but not yet against a live Discord
connection. One trade-off to watch: if more than 100 different members of one guild send messages
while a single database request is pending, a member can leave the cache before its handler runs.
AutoMod then fetches the member over the REST API instead, which is slower but correct.

## Stress test results

Measured with `npm run stress` on 1 October 2026 (Node.js 26.3, x64 Windows). Discord and Lavalink
are simulated with 80 ms and 20 ms round trips; see [testing.md](testing.md).

**Combined load: 2,000 servers, 3 voice and 3 music actions per server per second, 60 seconds.**

| Measure                        |                                   Result |
| ------------------------------ | ---------------------------------------: |
| Actions handled                |        624,000 (about 10,400 per second) |
| Voice rooms opened and deleted |    80,203 each; peak 43,962 open at once |
| Music plays                    | 109,124; peak 1,000 sessions (the limit) |
| CPU of the bot process         |                    8 to 12 % of one core |
| Heap / RSS peak                |                          264 MB / 446 MB |
| Event loop delay, p99          |                              28 to 35 ms |
| Invariant violations           |                                     none |

Latency per operation, including the simulated network round trips:

| Operation                   |    p50 |    p95 |    p99 |
| --------------------------- | -----: | -----: | -----: |
| Join lobby → room created   | 172 ms | 192 ms | 208 ms |
| Owner rename / limit / lock |  90 ms |  99 ms | 104 ms |
| Music play (search + start) |  30 ms |  76 ms |  99 ms |
| Music skip / pause / volume |  27 ms |  41 ms |  51 ms |

Almost all of that latency is the simulated Discord and Lavalink round trips; LunaEcho's own share
is a few milliseconds. On real Discord, channel creation is additionally rate-limited per server.

**With real SQL (PGlite in process), Voice Rooms only, 500 servers, 45 seconds:** 15,682 rooms
opened and deleted, no invariant violation, 17 % CPU in steady state. The database runs inside the
bot process in this setup, so CPU and event loop delay (p99 65 ms) include PostgreSQL's own work;
a separate PostgreSQL server takes that load off the bot.

**Bug found and fixed:** the music session limit was checked only against finished connections.
Under load, concurrent servers passed the check during their connect and reached 1,369 sessions
with a limit of 1,000. Slots are now reserved before connecting; a regression test and a stress
invariant guard it.

## Soak test

`npm run soak`: one hour, 500 servers, 2 voice and 2 music actions per server per second, music
limited to 400 sessions, samples every 30 seconds, first five minutes ignored.

| Measure                        |                                                 Result |
| ------------------------------ | -----------------------------------------------------: |
| Actions handled                |                               5.6 million, none failed |
| Voice rooms opened and deleted |                                           536,806 each |
| Steady state                   | ~12,500 open rooms, 400 sessions, ~26,000 queued songs |
| CPU of the bot process         |                               0.6 to 3.3 % of one core |
| Heap                           |                       oscillates between 63 and 130 MB |
| RSS peak                       |                                                 241 MB |
| Heap growth after warm-up      |       5.7 MB per hour, within garbage-collection noise |
| Invariant violations           |                                                   none |

**No memory leak was found.** A first run reported 67 MB per hour; that came from the test harness
itself, which kept every latency sample. It now records latencies in a fixed-size histogram and logs
open rooms, sessions, and queued songs with every sample, so growing application state can be told
apart from a leak. In the second run all three stayed flat while the heap did not trend upward.

**With a real PostgreSQL server (Docker), Voice Rooms only, 1,000 servers, 3 actions per server per
second, 60 seconds:** 40,946 rooms opened and deleted, no stored room left afterwards, no invariant
violation, 9 to 21 % CPU. Joining a lobby took 200 ms at p50 but 785 ms at p99, compared with
208 ms p99 in memory: at about 2,700 actions per second the default pool of 10 database
connections is the bottleneck. That is far above a single server's real load, but the pool size
needs revisiting for Cloud.

## Live test on Discord

`npm run live:voice` on the test server on 1 October 2026: LunaEcho against Docker PostgreSQL and
Lavalink, one helper bot joining the lobby, real Discord API.

| Run    | Rounds | Lobby → own room, p50 |      p95 | Timeouts | Left behind afterwards |
| ------ | -----: | --------------------: | -------: | -------: | ---------------------- |
| First  |      5 |                824 ms |   951 ms |        0 | nothing                |
| Second |     20 |                785 ms | 1,182 ms |        0 | nothing                |

Each round creates a channel and moves the member, two Discord API calls plus the gateway round
trip, which explains the difference to the simulated 172 ms. After both runs, no room channel,
stored room, or error remained.
