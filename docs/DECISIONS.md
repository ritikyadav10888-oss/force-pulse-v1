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
- 2026-11-23 — Sentry v11: Next config wrapper imported from `@sentry/nextjs/config`; Nest `SentryGlobalFilter` registered with `useClass` (a factory skips the property-injected HttpAdapterHost and turns 503s into 500s).
- 2026-11-23 — Staging on GCP (asia-south1) instead of Vercel/Render/Neon: Cloud Run for web and API, Cloud SQL Postgres 16 (db-f1-micro, daily backups + PITR), Artifact Registry, Secret Manager. Founder's call; local dev stays Docker Postgres 16.
- 2026-11-23 — GitHub → GCP auth via Workload Identity Federation restricted to this repo; no service-account JSON keys anywhere.
- 2026-11-23 — Migrations run as Cloud Run Job `fp-migrate` (same API image, Cloud SQL socket), so CI needs no Cloud SQL proxy or DB credentials.
- 2026-11-23 — Deploy workflow triggers on `workflow_run` of CI success on `main`; skipped until GCP repo variables exist.
- 2026-11-23 — Next.js `output: 'standalone'` for a small web image; `NEXT_PUBLIC_*` passed as Docker build args.
- 2026-11-23 — Milestone 7 backup drill becomes a Cloud SQL clone/restore (was: Neon branch restore).
- 2026-11-23 — GitHub repo is public (ritikyadav10888-oss/force-pulse-v1); deploy config uses repo variables, the only secret (DB URL) lives in Secret Manager.
- 2026-11-23 — Browser → API goes through the web app's same-origin `/api/*` rewrite, so session cookies are first-party (`run.app` is a public suffix; cross-site cookies would be blocked). `API_URL` is a web build arg.
- 2026-11-23 — Sessions: access JWT (HS256, 15 min, `@nestjs/jwt`) and opaque refresh token (7 days, sha256-hashed in DB, rotated on every refresh; reuse of a rotated token revokes all the user's sessions) in httpOnly, SameSite=Lax cookies; Secure in production. Bearer header also accepted for API clients.
- 2026-11-23 — Global `AuthGuard` (opt out with `@Public()`); `@TournamentRoles([...], 'tournament'|'registration')` checks Membership for the tournament behind `:id`; `super_admin` (Membership with null tournament) passes everywhere.
- 2026-11-23 — First admins: `SUPER_ADMIN_EMAILS`, granted only when Google says the email is verified. Accounts still link only by `google_sub`.
- 2026-11-23 — Google sign-in via the Google Identity Services script (no npm package); ID token verified server-side with `google-auth-library` behind an `AuthProvider` interface.
- 2026-11-23 — Validation: tiny `ZodPipe` + Swagger schemas generated from the same Zod schemas (`z.toJSONSchema`, OpenAPI 3.0 target). No `nestjs-zod`.
- 2026-11-23 — Prisma: tables snake_case plural (`@@map`), columns camelCase; UUID ids. Init migration generated with `migrate diff --from-empty` (no local DB yet).
- 2026-11-23 — Rule packs: Zod discriminated union on `scoringModel` so `format` is checked per model; cross-field checks (unique keys, `showIf` targets, overlay popups ⊆ events). Field types: select, multiselect, text, number, url, list. Options may carry a `group` (e.g. CB → DEF for fantasy).
- 2026-11-23 — Fields common to every sport (experience level, years played, highlight video, past teams) live once in `COMMON_FIELDS` in shared, not copied into six packs.
- 2026-11-23 — Conditional fields via `showIf {field, in}` (e.g. kabaddi defender position, chess FIDE ID). The sets pack uses a `discipline` field (badminton/table tennis/tennis/volleyball) instead of a separate variant concept.
- 2026-11-23 — Pack immutability enforced by `packs.lock.json` (sha256 of canonical JSON) checked in tests, and by the seed refusing to overwrite a published DB copy.
- 2026-11-23 — Seed (sports, packs, demo event + 2 open tournaments) runs after migrations in the `fp-migrate` Cloud Run Job on every deploy; idempotent.
- 2026-11-23 — Registration: rejected registrations can be resubmitted (back to pending); gender rule and age range checked against the event start date.
- 2026-11-23 — Walking-skeleton web UI is plain Tailwind; shadcn/ui and React Hook Form arrive with the profile wizard (Milestone 4).
