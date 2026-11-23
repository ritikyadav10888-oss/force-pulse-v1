# Build context: repo root. `docker build -f apps/web/Dockerfile .`
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /app
COPY . .
# Build-time values: API_URL is baked into the /api proxy rewrite; NEXT_PUBLIC_* into the browser bundle.
ARG API_URL
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID
ARG NEXT_PUBLIC_SENTRY_DSN
RUN pnpm install --frozen-lockfile && pnpm --filter "@force-pulse/web..." build

FROM node:22-slim
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=8080
WORKDIR /app
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
CMD ["node", "apps/web/server.js"]
