# syntax=docker/dockerfile:1
#
# One build for the bot and the dashboard; pick one with --target bot or --target dashboard.
# Secrets are never built in: they come from the environment when a container starts.

FROM node:24-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# Manifests first, so dependency layers are reused while only source code changes.
FROM base AS manifests
COPY package.json package-lock.json .npmrc ./
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/modules/package.json packages/modules/
COPY apps/bot/package.json apps/bot/
COPY apps/dashboard/package.json apps/dashboard/

FROM manifests AS build
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

# Only what runs in production: no TypeScript, test tools, or build caches.
FROM manifests AS runtime-dependencies
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=runtime-dependencies /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/packages/core/package.json packages/core/
COPY --from=build /app/packages/core/dist packages/core/dist
COPY --from=build /app/packages/db/package.json packages/db/
COPY --from=build /app/packages/db/dist packages/db/dist
COPY --from=build /app/packages/db/drizzle packages/db/drizzle
COPY --from=build /app/packages/modules/package.json packages/modules/
COPY --from=build /app/packages/modules/dist packages/modules/dist
COPY --from=build /app/packages/modules/assets packages/modules/assets
USER node

FROM runtime AS bot
COPY --from=build --chown=node:node /app/apps/bot/package.json apps/bot/
COPY --from=build --chown=node:node /app/apps/bot/dist apps/bot/dist
WORKDIR /app/apps/bot
CMD ["node", "dist/main.js"]

FROM runtime AS dashboard
COPY --from=build --chown=node:node /app/apps/dashboard/package.json apps/dashboard/
COPY --from=build --chown=node:node /app/apps/dashboard/next.config.ts apps/dashboard/
COPY --from=build --chown=node:node /app/apps/dashboard/public apps/dashboard/public
COPY --from=build --chown=node:node /app/apps/dashboard/.next apps/dashboard/.next
WORKDIR /app/apps/dashboard
EXPOSE 3000
CMD ["node", "/app/node_modules/next/dist/bin/next", "start", "--port", "3000"]
