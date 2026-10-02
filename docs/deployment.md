# Deployment

LunaEcho ships as two Docker images built from the root `Dockerfile`:

- `--target bot`: the Discord bot; it applies database migrations when it starts.
- `--target dashboard`: the Next.js dashboard on port 3000.

Secrets are never built into an image (`.dockerignore` excludes `.env` and `testbot/`); a
deployment passes them when a container starts.

## Cloud (the official shared bot)

`deploy/cloud/` holds the production setup: PostgreSQL, the bot, and the dashboard in one Compose
project. Cloud servers get the Cloud plan (`LUNA_RUNTIME_MODE=cloud-shared`), so Music,
Automation, and Social Notifications are off there and no Lavalink is needed.

The current server runs it from `~/lunaecho-cloud` next to other sites, behind the host's nginx:

| Piece      | Where                                                               |
| ---------- | ------------------------------------------------------------------- |
| Dashboard  | `https://lunaecho.shadowokami.com` → nginx → `127.0.0.1:3100`       |
| TLS        | Let's Encrypt via `certbot --nginx`, renewed automatically          |
| Database   | `postgres` container with a named volume; no published port         |
| Secrets    | `~/lunaecho-cloud/.env`, mode 600 (see `deploy/cloud/.env.example`) |
| Memory cap | postgres 384 MB, bot 512 MB, dashboard 512 MB                       |

Docker publishes ports past `ufw`, so every published port binds to `127.0.0.1` only.

### First setup

1. Point an A record for the dashboard host at the server.
2. Install Docker from Docker's Debian repository and add the user to the `docker` group.
3. Copy `deploy/cloud/docker-compose.yml` to `~/lunaecho-cloud/` and create `.env` there from
   `deploy/cloud/.env.example` (`openssl rand` for the two random secrets).
4. Install `deploy/cloud/nginx-lunaecho.conf` as an nginx site and run
   `sudo certbot --nginx -d <host> --redirect`.
5. Add `<DASHBOARD_URL>/api/auth/callback` as an OAuth2 redirect in the Developer Portal.
6. Make sure no other process uses the same bot token, then `docker compose up -d`.

### Updating

Build both images locally, tag them, and stream them to the server; the server needs no access
to the repository:

```bash
docker build --target bot -t lunaecho-bot:latest .
docker build --target dashboard -t lunaecho-dashboard:latest .
docker save lunaecho-bot:latest lunaecho-dashboard:latest | gzip -1 \
  | ssh <user>@<server> "gunzip | docker load"
ssh <user>@<server> "cd ~/lunaecho-cloud && docker compose up -d"
```

Tag a dated version as well (for example `cloud-20261003-1`) so a bad update can be rolled back
by setting `LUNAECHO_VERSION` in `.env`.

## Custom

Not deployed yet. Each Custom customer will get their own bot process with their own token and
database, sharing one Lavalink node, so one customer's data and limits never touch another's.
