# Decisions

One line per decision, newest last.

- 2026-11-23 — pnpm workspaces, no Turborepo: `pnpm -r` / `--filter pkg...` already builds in dependency order.
- 2026-11-23 — CI and deploys run Node 22 (`.nvmrc`); `engines: >=22` so local Node 24 also works.
- 2026-11-23 — pnpm 9.15.9 pinned via `packageManager`; installed with `npm i -g` locally because `corepack enable` needs admin on Windows.
- 2026-11-23 — Project stays in OneDrive for now; move it if file locks or slow installs appear.
- 2026-11-23 — Prisma 6 (not 7): stable with CommonJS NestJS and needs no driver adapter; revisit at Gate 2.
- 2026-11-23 — Prisma schema lives in `apps/api` (only the API talks to the DB).
- 2026-11-23 — Zod 4: built-in `z.toJSONSchema` replaces `zod-to-json-schema` for the rule-pack JSON Schema.
- 2026-11-23 — `@force-pulse/shared` compiles to CommonJS `dist/` so both Nest (CJS) and Next can consume it.
- 2026-11-23 — Health checks hand-written (`SELECT 1`) instead of `@nestjs/terminus`: ~10 lines, one less dependency.
- 2026-11-23 — Logging: `nestjs-pino`; JSON when stdout is not a TTY (deploys), pretty in a local terminal. Auth headers and cookies redacted.
- 2026-11-23 — Env loading: `process.loadEnvFile()` (Node built-in) instead of `@nestjs/config`/dotenv.
- 2026-11-23 — Vitest runs Nest tests through `unplugin-swc` because esbuild drops decorator metadata that Nest DI needs.
- 2026-11-23 — Single root ESLint flat config (typescript-eslint recommended + prettier) for all packages; Next ESLint plugin skipped.
- 2026-11-23 — CI migration check: `migrate deploy` then `migrate diff --from-url --to-schema-datamodel --exit-code` (no shadow DB needed).
- 2026-11-23 — shadcn/ui is initialised with its first component (Milestone 2), not empty in M1.
- 2026-11-23 — Sentry v11: Next config wrapper imported from `@sentry/nextjs/config`; Nest `SentryGlobalFilter` built via factory because it ships without DI metadata.
- 2026-11-23 — Staging on GCP (asia-south1) instead of Vercel/Render/Neon: Cloud Run for web and API, Cloud SQL Postgres 16 (db-f1-micro, daily backups + PITR), Artifact Registry, Secret Manager. Founder's call; local dev stays Docker Postgres 16.
- 2026-11-23 — GitHub → GCP auth via Workload Identity Federation restricted to this repo; no service-account JSON keys anywhere.
- 2026-11-23 — Migrations run as Cloud Run Job `fp-migrate` (same API image, Cloud SQL socket), so CI needs no Cloud SQL proxy or DB credentials.
- 2026-11-23 — Deploy workflow triggers on `workflow_run` of CI success on `main`; skipped until GCP repo variables exist.
- 2026-11-23 — Next.js `output: 'standalone'` for a small web image; `NEXT_PUBLIC_*` passed as Docker build args.
- 2026-11-23 — Milestone 7 backup drill becomes a Cloud SQL clone/restore (was: Neon branch restore).
- 2026-11-23 — GitHub repo is public (owner: ritikyadav10888-oss); deploy config uses repo variables, the only secret (DB URL) lives in Secret Manager.
