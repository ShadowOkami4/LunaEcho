# Testing

| Level           | Command              | Needs                                             | Checks                                          |
| --------------- | -------------------- | ------------------------------------------------- | ----------------------------------------------- |
| Unit and SQL    | `npm run check`      | nothing                                           | logic, real migrations and SQL on PGlite, build |
| Micro-benchmark | `npm run bench`      | nothing                                           | CPU, memory, and storage cost per item          |
| Stress          | `npm run stress`     | nothing                                           | throughput, latency, invariants under load      |
| Soak            | `npm run soak`       | nothing, runs one hour                            | memory growth, stability over time              |
| Live            | `npm run live:voice` | Discord test server, helper bots, the running bot | real Discord behaviour end to end               |

## Stress test

`npm run stress` drives the real Voice Rooms and Music services with thousands of simulated
members. Discord and Lavalink are replaced by simulations that add network latency, so the numbers
show LunaEcho's own cost, not Discord's.

```sh
npm run stress -- --scenario all --guilds 2000 --rate 3 --duration 60
npm run stress -- --scenario voice --database pglite   # real SQL, in process
npm run stress -- --scenario voice --database postgres # real server via DATABASE_URL
```

Each run prints latency percentiles per operation, CPU, heap, RSS, and event loop delay, writes a
JSON report to `apps/bot/stress-results/`, and **fails if an invariant breaks**:

- after everyone leaves, no room, stored room record, or simulated channel remains
- after shutdown, no music session or audio player remains
- concurrent music sessions never exceed the configured limit

## Soak test

`npm run soak` runs the combined load for one hour, samples every 30 seconds, and reports the heap
growth per hour after a five-minute warm-up. A clearly positive value over a long run points to a
memory leak. Pass `--duration` to run longer.

## Live test on the test server

The live test measures the real path through Discord: a helper bot joins the lobby, LunaEcho
creates a room and moves the helper into it.

1. Create one to three **separate** Discord applications as helper bots and invite them to the
   test server with the Connect permission. Never use the LunaEcho token for this.
2. In `.env` for the running LunaEcho bot, list the helper bots' user ids in `LOAD_TEST_BOT_IDS`.
   Without it LunaEcho ignores bots in lobbies. Remove it again after testing.
3. Start PostgreSQL, run `npm run commands:deploy` (deploys to the test server only), and start the
   bot with `npm run dev`. Set up a lobby with `/voice-rooms setup` or in the dashboard.
4. Run the load, which only acts in `DISCORD_DEVELOPMENT_GUILD_ID`:

   ```sh
   LOAD_BOT_TOKENS=helper1,helper2 LIVE_LOBBY_CHANNEL_ID=<lobby id> npm run live:voice -- --rounds 20
   ```

It reports how long each lobby-to-room move took and how many timed out. Discord rate-limits
channel creation per server, so expect latencies well above the simulation's.

`npm run live:music` checks real playback: a helper bot joins a voice channel and plays one result per search source through Lavalink, and only a moving playback position counts as success (see [music.md](music.md)).

Music has no automated live load test: bots cannot run another bot's slash commands, and one bot
can play in only one channel per server. Test music by hand on the test server and watch
Lavalink's `/metrics` endpoint.
