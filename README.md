# Force Pulse

Multi-sport tournament management: registration, player auctions, live scoring, fantasy and stream overlays. This repo is at **Gate 1 (Foundation)**.

## Layout

| Path                  | What                                             |
| --------------------- | ------------------------------------------------ |
| `apps/web`            | Next.js (App Router) + Tailwind, mobile-first    |
| `apps/api`            | NestJS REST API, Swagger at `/docs`, Prisma      |
| `packages/shared`     | Zod schemas and types shared by web and API      |
| `packages/rule-packs` | Versioned JSON rule pack per sport (Milestone 2) |
| `docs/DECISIONS.md`   | Why things are the way they are                  |

## Local setup

Needs Node 22+ (`.nvmrc`), pnpm 9 and Docker Desktop.

```sh
pnpm install
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
pnpm db:up                                  # Postgres 16 on localhost:5432
pnpm --filter @force-pulse/api db:migrate   # apply migrations
pnpm dev                                    # web :3000, api :4000
```

- Web: http://localhost:3000, health at http://localhost:3000/health
- API: http://localhost:4000/health, Swagger at http://localhost:4000/docs

## Scripts (root)

| Script                       | Does                                                 |
| ---------------------------- | ---------------------------------------------------- |
| `pnpm dev`                   | Builds shared, runs web and API in watch mode        |
| `pnpm lint` / `format:check` | ESLint / Prettier                                    |
| `pnpm typecheck`             | `tsc --noEmit` in every package (build shared first) |
| `pnpm test`                  | Vitest in every package (API tests need Postgres)    |
| `pnpm build`                 | Builds everything in dependency order                |

## Environment variables

Never commit real values. `.env` / `.env.local` are git-ignored.

### API (`apps/api/.env`; on Cloud Run set by the deploy workflow)

| Variable             | Required | Description                                                                   |
| -------------------- | -------- | ----------------------------------------------------------------------------- |
| `DATABASE_URL`       | yes      | Postgres URL. Staging: Secret Manager `database-url` (Cloud SQL unix socket). |
| `PORT`               | no       | Default `4000`. Cloud Run sets it to 8080.                                    |
| `CORS_ORIGIN`        | no       | Comma-separated allowed origins. Default `http://localhost:3000`.             |
| `LOG_LEVEL`          | no       | pino level (`info`, `debug`, `silent`…). Default `info`.                      |
| `SENTRY_DSN`         | no       | Sentry DSN for the API project. Empty disables Sentry.                        |
| `SENTRY_ENVIRONMENT` | no       | `development` / `staging` / `production`.                                     |

### Web (`apps/web/.env.local`; on Cloud Run baked in at image build)

| Variable                 | Required | Description                                                   |
| ------------------------ | -------- | ------------------------------------------------------------- |
| `NEXT_PUBLIC_API_URL`    | yes      | Base URL of the API.                                          |
| `NEXT_PUBLIC_SENTRY_DSN` | no       | Sentry DSN for the web project. Empty disables Sentry.        |
| `SENTRY_ORG`             | no       | Build only: Sentry org slug for source map upload.            |
| `SENTRY_PROJECT`         | no       | Build only: Sentry project slug.                              |
| `SENTRY_AUTH_TOKEN`      | no       | Build only: Sentry auth token. Without it, upload is skipped. |

## CI/CD

`.github/workflows/ci.yml` runs on every PR and push to `main`: format, lint, typecheck, Prisma migrate + drift check against a Postgres service, tests and build.

Staging runs on **GCP, region asia-south1**: Cloud Run services `fp-web` and `fp-api`, Cloud SQL Postgres 16 (`force-pulse-staging`), images in Artifact Registry, `DATABASE_URL` in Secret Manager.

`.github/workflows/deploy-staging.yml` runs after CI passes on `main` (or by hand from the Actions tab). It authenticates with Workload Identity Federation (no JSON keys), builds both images, runs `prisma migrate deploy` as the Cloud Run Job `fp-migrate`, deploys the API, then builds the web image with the API URL and deploys it, then smoke-tests both `/health` endpoints. The workflow is skipped until the repo variables below exist.

One-time setup:

1. Create a GCP project and enable billing. Cloud SQL `db-f1-micro` costs about $9–10/month; Cloud Run scales to zero.
2. Open Cloud Shell, upload `docs/gcp-setup.sh` and run `PROJECT_ID=<id> bash gcp-setup.sh`.
3. Run the `gh variable set …` lines it prints (repo variables: `GCP_PROJECT_ID`, `GCP_REGION`, `GCP_WIF_PROVIDER`, `GCP_DEPLOYER_SA`, `GCP_RUNTIME_SA`, `CLOUDSQL_CONNECTION`).
4. Optional: Sentry. Create projects `force-pulse-web` and `force-pulse-api`, then set repo variables `WEB_SENTRY_DSN` and `API_SENTRY_DSN`.
5. Run **Deploy staging** from the Actions tab, then run it **once more**. The first run creates `fp-web` after the API, so the API's `CORS_ORIGIN` is only filled in on the second run.

**Live staging:**

- Web: https://fp-web-407846370044.asia-south1.run.app (health: `/health`)
- API: https://fp-api-407846370044.asia-south1.run.app (health: `/health`, Swagger: `/docs`)
- GCP project `forcepulse` (number 407846370044), Cloud SQL instance `force-pulse-staging`

## Uptime checks

Use Cloud Monitoring uptime checks (free tier) or UptimeRobot:

- `GET <fp-api URL>/health`: expect HTTP 200 and content `"status":"ok"`. A 503 means Cloud SQL is unreachable.
- `GET <fp-web URL>/health`: expect HTTP 200.
- Interval 5 minutes, email alert. Cloud Run scales to zero, so allow a 30 s timeout for cold starts.
