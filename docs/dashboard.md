# Dashboard

`apps/dashboard` is a Next.js app. Server administrators sign in with Discord, pick a server, and
configure its modules. It reads and writes the same PostgreSQL database as the bot through
`@lunaecho/modules`, so both apply the same validation and limits.

## Setup

1. In the Discord Developer Portal, open the LunaEcho application → **OAuth2**:
   - copy the **Client Secret** into `.env` as `DISCORD_CLIENT_SECRET`
   - add the redirect `http://localhost:3000/api/auth/callback` (and your production URL)
2. Add to `.env`:

   ```sh
   DASHBOARD_URL=http://localhost:3000
   DISCORD_CLIENT_SECRET=...
   SESSION_SECRET=...   # at least 32 random characters, e.g. `openssl rand -base64 48`
   ```

3. Make sure the database is migrated: start the bot once or run `npm run db:migrate`. The
   dashboard never migrates on its own.
4. `npm run build` once (the dashboard uses the compiled workspace packages), then
   `npm run dashboard` while developing (pages compile on first visit, so they load slowly) or
   `npm run dashboard:start` for a fast production build on the same port.

## Pages

| Page        | What it does                                                                              |
| ----------- | ----------------------------------------------------------------------------------------- |
| Servers     | Lists servers you can manage; offers an invite link where LunaEcho is missing             |
| Modules     | Turns modules on and off; planned modules are shown as coming later                       |
| Moderation  | AutoMod profile, every rule's switch and response, banned words, exceptions, recent cases |
| Voice Rooms | Adds and removes lobbies with category, name template, and member limit                   |
| Music       | DJ role and default volume                                                                |
| Levels      | XP rates, cooldown, announcements, ignored channels and roles, role rewards, leaderboard  |
| Logs        | One channel per log category, ignored channels                                            |
| Welcome     | Messages, autoroles, verification, and the welcome card designer with live preview        |
| Roles       | Creates, edits, posts, and deletes role menus                                             |
| Tickets     | Ticket channel, transcript channel, team roles, limit per member; posts the ticket panel  |
| Automation  | Creates, edits, switches, and deletes rules                                               |
| Social      | Follows YouTube channels and Twitch streamers                                             |

Every change queues a task for the bot, which polls the queue every two seconds and drops its
cached settings for that server, so changes apply within a few seconds. Posting panels (role
menus, verification, tickets) goes through the same queue, because only the bot talks to Discord.

Validation messages from a failed save are carried to the next page view in a short-lived,
HTTP-only cookie, never in the URL, so a crafted link cannot show arbitrary text.

## Security

- **Access** mirrors Discord: only the server owner, administrators, and members with Manage
  Server can open a server, and LunaEcho must be in it. Every page and every change re-checks this
  with Discord's own permission data; a server you cannot manage looks like a missing page.
- **Sessions** are encrypted, HTTP-only cookies (`iron-session`). The Discord access token lives
  only in that cookie and is never readable by browser scripts.
- **Login** uses Discord OAuth2 with a random `state`, compared in constant time.
- **Changes** run as Next.js server actions, which reject requests from other origins. Channel and
  role ids from forms are checked against the server's real channels and roles before saving.
- **Sign-out** accepts only POST, so other sites cannot sign anyone out through a link.
- The bot token is used server-side only, to read the server's channels and roles.

## Welcome cards

The bot draws welcome and goodbye cards with `@napi-rs/canvas`: the member's avatar with an accent
ring, a title, and a subtitle on a preset background or an uploaded picture. The designer on the
Welcome page shows a live preview, drawn on the server by the same renderer with the signed-in
user as the sample member (`/servers/[guildId]/welcome/card-preview`, managers only).

Uploaded pictures are decoded, cropped to 1024 x 450, and re-encoded as JPEG before they are
stored in PostgreSQL, so nothing of the original file survives and anything that is not a picture
is rejected. The bot never downloads pictures from user-supplied addresses; avatars come from
Discord's CDN only.
