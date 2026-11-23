# Build context: repo root. `docker build -f apps/api/Dockerfile .`
FROM node:22-slim AS build
# Prisma's query engine needs OpenSSL.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/* && corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter "@force-pulse/api..." build

FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
# shortcut: ships the whole workspace incl. dev deps (needed for `prisma migrate deploy` in the migrate job); slim with `pnpm deploy` if image size matters.
COPY --from=build /app /app
WORKDIR /app/apps/api
CMD ["node", "dist/main.js"]
