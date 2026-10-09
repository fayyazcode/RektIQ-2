# Supabase Postgres Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace MongoDB with Supabase Postgres as RektoIQ's single runtime database, migrate retained data safely, and move recurring production jobs from GitHub schedules to Supabase Cron.

**Architecture:** Add a typed Drizzle/Postgres persistence layer and normalized schema, then convert application reads and writes behind repositories while preserving page/API contracts. Import and reconcile Mongo data before a controlled cutover; configure Supabase Cron to invoke authenticated bounded app routes, retaining Mongo read-only for rollback. Current market signals, anomalies, and future X/sentiment signals remain separate models.

**Tech Stack:** Next.js 16, TypeScript, Drizzle ORM, `pg`, Supabase Postgres, Supabase Cron/Vault/`pg_net`, Vitest, existing MongoDB driver for the one-time importer.

**Spec:** `docs/superpowers/specs/2026-10-01-supabase-postgres-migration-design.md`

## Global Constraints

- Supabase Postgres is the sole application database after cutover; do not add permanent dual writes.
- RSS/article/story data follows the existing 30-day retention policy.
- Raw posts from monitored X accounts are deduplicated, associated with their author, and retained for 20 days.
- Signal events and their evidence/outcomes remain indefinitely for analytics.
- Existing signal and anomaly features remain free in this phase; subscription plans, billing, and paywall enforcement are out of scope.
- Keep current market-threshold signals, market anomalies, and future X/sentiment signals distinct in storage and analytics.
- Supabase Cron becomes the only recurring production scheduler after replacement schedules are verified; GitHub CI remains.
- Keep all database and Cron credentials server-side; never expose privileged credentials to the browser.
- Do not run migrations or data cleanup during page requests.

## Review Focus

1. Duplicate or partially imported documents: importer retries must be idempotent and preserve unique natural keys.
2. Broken Mongo ObjectId relationships: foreign keys and nullability must preserve article/story, news/article, and signal/outcome links.
3. Premature signal deletion: no TTL or cleanup path may delete historical signal events or outcome checkpoints.
4. Immature outcome checkpoints: pending results must not enter success-rate denominators; show pending and matured sample counts.
5. Overlapping/unauthorized Cron calls: reject unauthorized requests and prevent concurrent execution of the same scheduled job.

---

## File and module map

- `src/lib/db.ts`: replace Mongo connection/collection bootstrap with the server-only Postgres connection and stable database exports.
- `src/lib/db/schema/`: Drizzle table definitions grouped into editorial, operations, intelligence, and tracked-social domains.
- `drizzle.config.ts`, `drizzle/`: schema configuration and versioned SQL migrations.
- `src/lib/data/queries.ts`, `src/lib/data/intel-queries.ts`: keep their public query/view-model interfaces while moving query implementation to SQL/repositories.
- `src/lib/data/repositories/`: focused repository operations used by routes, admin, and jobs; no Mongo-style generic collection facade.
- `src/lib/jobs/`, `scripts/`: adapt job persistence and add resumable import/reconciliation commands.
- `src/app/api/cron/`: retain existing authenticated routes and add bounded realtime, anomaly, and outcome routes for Supabase Cron.
- `supabase/cron/`: reviewed schedule SQL/template and setup notes; secrets are created in Supabase Vault separately, never committed.
- `.env.example`, `DEPLOYMENT.md`, `README.md`: document runtime/migration connection settings and staged cutover.
- `tests/`: repository, job idempotency, model-separation, importer mapping, outcome aggregation, and Cron authorization tests.

## Task 1: Add Postgres schema and migration foundation

**Files:**
- Create: `drizzle.config.ts`
- Create: `src/lib/db/client.ts`
- Create: `src/lib/db/schema/editorial.ts`
- Create: `src/lib/db/schema/operations.ts`
- Create: `src/lib/db/schema/intelligence.ts`
- Create: `src/lib/db/schema/tracked-social.ts`
- Create: `src/lib/db/schema/index.ts`
- Create: `drizzle/0000_initial_schema.sql` (generated from the reviewed schema)
- Modify: `src/lib/db.ts`, `src/lib/env.ts`, `.env.example`, `package.json`, `package-lock.json`
- Test: `tests/db/schema.test.ts`

**Interfaces:**
- Export `getDatabase(): NodePgDatabase<typeof schema>` and `closeDatabase(): Promise<void>` from `src/lib/db/client.ts`.
- Export all tables from `src/lib/db/schema/index.ts`.
- Runtime uses `DATABASE_URL` (Supabase pooled connection); migration tooling uses `DATABASE_MIGRATION_URL` (direct/session connection). Mongo is not a runtime fallback.

**Table mapping:**
- Mongo `articles` → `articles`; Mongo `stories` → `stories` plus normalized `story_articles` links.
- Mongo `social_posts` → `outbound_posts`; Mongo `automation_runs` → `job_runs`; Mongo `feed_state` → `feed_state`; Mongo `settings` → `app_settings`; Mongo `login_attempts` → `login_attempts`.
- Mongo `assets` → `assets`; Mongo `market_snapshots` → `market_snapshots`; Mongo `signals` → `market_signals` plus `signal_outcomes`; Mongo `anomalies` → `market_anomalies`.
- Mongo `news_entities` → `news_entities`; Mongo `news_impacts` → `news_impacts`; Mongo `ai_analyses` → `ai_analyses`; Mongo `provider_health` → `provider_health`.
- Planned social model foundations: `tracked_x_accounts`, `tracked_x_posts`, `tracked_x_post_assets`, `social_signals`, and `social_signal_evidence`. These are separate from outbound posts, market signals, and anomalies.

- [ ] **Step 1: Write schema tests** asserting unique article URL hash, story slug, social post external ID, market signal dedupe key, and foreign keys; assert no signal/outcome TTL deletion definition exists.
- [ ] **Step 2: Run the schema test** with `npm test -- tests/db/schema.test.ts`; expected: fail until tables and constraints exist.
- [ ] **Step 3: Define typed domain tables** for the 15 current Mongo collections plus signal outcome checkpoints and future tracked-X accounts/posts/mentions. Use UUID PKs, `legacy_mongo_id` columns for imported Mongo documents, natural unique constraints, and JSONB only for versioned flexible evidence/provider payloads.
- [ ] **Step 4: Add Postgres connection and Drizzle config** using `pg`/`drizzle-orm/node-postgres`; keep one cached pool per server process and expose explicit close for jobs.
- [ ] **Step 5: Generate and inspect the initial SQL migration**; verify foreign keys, indexes, defaults, and uniqueness match `src/lib/db.ts` behavior except signal TTL is intentionally removed.
- [ ] **Step 6: Run schema tests and typecheck** with `npm test -- tests/db/schema.test.ts` and `npm run typecheck`; expected: PASS.
- [ ] **Step 7: Commit** `feat(db): add Supabase Postgres schema foundation`.

## Task 2: Move read paths and admin/auth persistence to repositories

**Files:**
- Create: `src/lib/data/repositories/editorial.ts`
- Create: `src/lib/data/repositories/operations.ts`
- Modify: `src/lib/data/queries.ts`, `src/lib/settings.ts`, `src/lib/auth/rate-limit.ts`, `src/lib/db-info.ts`, `src/app/admin/actions.ts`, `src/app/admin/(panel)/page.tsx`
- Test: `tests/db/editorial-repositories.test.ts`, `tests/db/operations-repositories.test.ts`

**Interfaces:**
- Preserve signatures and view-model return types for `getTopStories`, `getStories`, `getStoryBySlug`, `getRelatedStories`, `toPostViews`, `getPublicPosts`, `getLastIngest`, `countStoriesSince`, `getSourceCounts`, `getSitemapStories`, `getRuns`, `getFeedStates`, `getAdminPosts`, and `getAdminStats` from `src/lib/data/queries.ts`.
- Repository functions take typed filter/limit inputs and return typed rows; they do not expose Drizzle query builders to callers.
- Keep global settings as one row and feed state keyed by source ID.

- [ ] **Step 1: Add failing tests** for story list/search/detail, story/article joins, recent articles, admin post-slot lookup, setting upsert, and login-attempt rate limiting.
- [ ] **Step 2: Run the focused repository tests**; expected: FAIL while existing functions still depend on Mongo.
- [ ] **Step 3: Implement editorial and operations repositories** with parameterized SQL/Drizzle queries and preserve sort/pagination semantics.
- [ ] **Step 4: Convert callers** in page data queries, admin actions/dashboard, settings, login limiting, and DB diagnostics without changing route/view-model contracts.
- [ ] **Step 5: Run focused tests and typecheck**; expected: PASS with no `mongodb` imports in converted files.
- [ ] **Step 6: Commit** `refactor(db): move editorial and admin reads to Postgres`.

## Task 3: Convert RSS ingestion, story updates, publishing, and cleanup writes

**Files:**
- Create: `src/lib/data/repositories/ingestion.ts`
- Create: `src/lib/data/repositories/publishing.ts`
- Modify: `src/lib/jobs/ingest.ts`, `src/lib/jobs/summaries.ts`, `src/lib/jobs/breaking.ts`, `src/lib/jobs/daily-posts.ts`, `src/lib/jobs/sync-posts.ts`, `src/lib/jobs/cleanup.ts`, `src/lib/social/xgen.ts`, `src/app/admin/actions.ts`
- Test: `tests/db/ingestion-repositories.test.ts`, `tests/db/publishing-repositories.test.ts`, existing `tests/hourly.test.ts`, `tests/posts.test.ts`, `tests/breaking.test.ts`

**Interfaces:**
- Preserve job entry-point signatures and current `RunDoc`-style externally returned statistics until public admin types are deliberately updated.
- `upsertArticle(article, runId): Promise<{ kind: "inserted" | "updated" | "unchanged"; articleId: string }>` must enforce URL-hash idempotency.
- `upsertStory(story, articleId): Promise<{ storyId: string; merged: boolean }>` must preserve slug and clustering relationships.
- `recordJobRun(...)` returns a stable UUID run ID and supports status/count updates.

- [ ] **Step 1: Add failing repository/job tests** asserting duplicate RSS batches do not duplicate articles/stories, daily slot uniqueness survives retries, and cleanup obeys the 30-day content policy.
- [ ] **Step 2: Run focused tests**; expected: FAIL against missing SQL repository methods.
- [ ] **Step 3: Implement transactional article/story upserts and run logging** with unique constraints as the final concurrency guard.
- [ ] **Step 4: Convert publishing, Buffer sync, breaking alerts, summaries, settings writes, and cleanup** to repositories; make cleanup chunked and preserve the spec's distinct retention rules.
- [ ] **Step 5: Run affected existing tests and focused repository tests**; expected: PASS and retrying a job creates no duplicate post/slot/article.
- [ ] **Step 6: Commit** `refactor(jobs): persist editorial and publishing workflows in Postgres`.

## Task 4: Convert intelligence reads/writes and preserve model boundaries

**Files:**
- Create: `src/lib/data/repositories/intelligence.ts`
- Create: `src/lib/data/repositories/signal-outcomes.ts`
- Modify: `src/lib/data/intel-queries.ts`, `src/lib/signals/engine.ts`, `src/lib/signals/outcomes.ts`, `src/lib/anomalies/engine.ts`, `src/lib/market/health.ts`, `src/lib/ai-intel/explainer.ts`, `scripts/realtime-worker.ts`, `scripts/anomalies-worker.ts`, `scripts/news-correlation.ts`
- Test: `tests/db/intelligence-repositories.test.ts`, `tests/db/signal-outcomes.test.ts`, existing signal/anomaly/market/news tests

**Interfaces:**
- `insertMarketSignal(signal): Promise<{ id: string; inserted: boolean }>` deduplicates by market signal key and never expires historical records.
- `upsertOutcomeCheckpoint(signalId, horizon, result): Promise<void>` accepts only `"4h" | "1d" | "1w"` for new evaluations and is idempotent per signal/horizon. The migration can preserve existing 1h outcome data as a legacy historical horizon, but no new 1h checks are scheduled.
- `getSignalPerformance(period, model): Promise<{ matured: number; pending: number; successes: number; failures: number; rate: number | null }>` filters by model and excludes pending outcomes from the rate denominator.
- Preserve `getOverview`, `getAssetDetail`, `listSignals`, `listAnomalies`, `listNewsImpacts`, `getDegenRadar`, and `getProviderHealthList` signatures from `src/lib/data/intel-queries.ts`.
- Anomaly rows and future social-signal records have distinct discriminators/table ownership; do not insert social sentiment events into market `signals` or `anomalies`.

- [ ] **Step 1: Add failing tests** for signal dedupe/history preservation, anomaly persistence/retention, news joins, provider health, and 4h/1d/1w checkpoint idempotency and performance denominators.
- [ ] **Step 2: Run focused tests**; expected: FAIL until repository behavior exists.
- [ ] **Step 3: Implement intelligence repositories** and convert market, signal, anomaly, AI, news-impact, and provider-health writers/readers.
- [ ] **Step 4: Extend outcome persistence from current one-hour/four-hour shapes to target 4h/1d/1w rows**; import prior 1h/4h results as historical checkpoints where present, and do not synthesize missing 1d/1w checkpoints.
- [ ] **Step 5: Implement analytics queries** for weekly/monthly/quarterly/yearly periods, returning matured and pending counts; keep market-signal performance separate from anomaly counts and future social-model outputs.
- [ ] **Step 6: Run focused tests, `npm run typecheck`, and the existing affected suites**; expected: PASS.
- [ ] **Step 7: Commit** `refactor(intel): persist market intelligence and outcomes in Postgres`.

## Task 5: Add resumable import and reconciliation tools

**Files:**
- Create: `scripts/migrate-mongo-to-postgres.ts`
- Create: `scripts/verify-mongo-postgres.ts`
- Create: `src/lib/db/migration/map-document.ts`
- Modify: `package.json`, `.env.example`, `DEPLOYMENT.md`
- Test: `tests/db/migration-map.test.ts`, `tests/db/migration-import.test.ts`

**Interfaces:**
- `mapMongoDocument(collectionName, document): { tableName: string; row: Record<string, unknown> }` deterministically maps each supported collection and legacy ID.
- `importMongoBatch(sourceCollection, afterId, batchSize): Promise<{ lastId: string | null; read: number; inserted: number; updated: number }>` is resumable and idempotent.
- `verifyMigration(): Promise<ReconciliationReport>` returns source/destination counts, unique-key differences, orphan relationships, and sampled content-hash mismatches without mutating either database. `ReconciliationReport` contains `{ clean: boolean; collections: Array<{ name: string; sourceCount: number; destinationCount: number; uniqueKeyMismatches: number; orphanCount: number; sampledHashMismatches: number }> }`.

- [ ] **Step 1: Add failing mapping tests** for ObjectId references, dates, optional fields, nested evidence/outcomes, and social posts; malformed or unknown collection data must fail with a clear collection/document ID.
- [ ] **Step 2: Add failing importer tests** asserting a second import does not add duplicate rows and preserves relationships.
- [ ] **Step 3: Implement deterministic document mapping** with explicit per-collection conversions and a mapping for all 15 current collections.
- [ ] **Step 4: Implement batched upsert importer** with a durable checkpoint per source collection and dry-run mode; retain source Mongo unchanged.
- [ ] **Step 5: Implement read-only reconciliation report** covering row counts, natural-key counts, foreign-key orphans, and canonical sampled hashes.
- [ ] **Step 6: Run mapping/import tests and typecheck**; expected: PASS. Do not run against production until a verified export and Supabase target are selected.
- [ ] **Step 7: Commit** `feat(db): add resumable Mongo migration and verification tools`.

## Task 6: Move recurring jobs to authenticated Supabase Cron triggers

**Files:**
- Create: `src/app/api/cron/realtime/route.ts`
- Create: `src/app/api/cron/anomalies/route.ts`
- Create: `src/app/api/cron/outcomes/route.ts`
- Create: `src/lib/jobs/locks.ts`
- Create: `supabase/cron/schedules.sql`
- Modify: `src/app/api/cron/guard.ts`, existing `src/app/api/cron/*/route.ts`, `scripts/realtime-worker.ts`, `scripts/anomalies-worker.ts`, `vercel.json`, `.env.example`, `DEPLOYMENT.md`
- Test: `tests/cron/authorization.test.ts`, `tests/cron/locks.test.ts`, `tests/cron/routes.test.ts`

**Interfaces:**
- `acquireJobLock(jobName, leaseSeconds): Promise<{ acquired: true; release(): Promise<void> } | { acquired: false }>` uses Postgres advisory locking or durable lease semantics and releases in `finally`.
- `authorized(req)` checks a high-entropy `CRON_SECRET` using constant-time comparison.
- Every route returns `{ ok: boolean, runId?: string, skipped?: string, error?: string }` and invokes one bounded job; route time must remain within configured Vercel duration.

- [ ] **Step 1: Add failing tests** for missing/wrong cron secrets, lock contention/release, and authenticated route success/failure results.
- [ ] **Step 2: Implement Postgres-backed overlap protection** and extend route authorization without logging credentials.
- [ ] **Step 3: Add bounded realtime/anomaly/outcome route adapters**; realtime route performs one market tick, anomaly route one analysis batch, outcome route due checkpoint batch.
- [ ] **Step 4: Adapt existing ingest/posts/sync/cleanup routes** to Postgres run records and stable result shapes.
- [ ] **Step 5: Add schedule SQL/template** for all required recurring jobs, using HTTP calls to authenticated Vercel routes and Vault-held secrets; retain manual dispatch routes during verification.
- [ ] **Step 6: Add schedule/route tests and run them with typecheck**; expected: PASS, unauthorized requests cause no writes, duplicate overlapping calls skip safely.
- [ ] **Step 7: Commit** `feat(cron): add Supabase scheduled job endpoints`.

## Task 7: Rehearse and execute data cutover with rollback

**Files:**
- Modify: `DEPLOYMENT.md`, `README.md`, `.env.example`, `.github/workflows/hourly-ingest.yml`, `.github/workflows/daily-posts.yml`, `.github/workflows/daily-cleanup.yml`, `.github/workflows/post-sync.yml`, `.github/workflows/realtime.yml`, `.github/workflows/anomalies.yml`
- Create: `docs/superpowers/runbooks/supabase-cutover.md`
- Test/verify: staging Supabase project and production-read-only Mongo export (no committed credentials/data)

**Interfaces:**
- Runbook defines required env values: `DATABASE_URL`, `DATABASE_MIGRATION_URL`, `MONGODB_URI` (import/rollback only), and `CRON_SECRET`; Supabase Vault holds the outbound Cron credential.
- Cutover has explicit states: `mongo_active`, `imported`, `reconciled`, `cron_verified`, `postgres_active`, `rollback_window`, `mongo_retired`.

- [ ] **Step 1: Document setup and backup prerequisites** including Supabase project region, Free-plan DB-size headroom, verified Mongo export, Postgres restore check, and secret configuration.
- [ ] **Step 2: Rehearse full import on staging**; expected: importer resumes after interruption and reconciliation reports zero unexplained count/key/orphan/hash differences.
- [ ] **Step 3: Rehearse every Cron route manually** and confirm Supabase run history, app job-run records, authorization failures, overlap handling, and runtime limits.
- [ ] **Step 4: Run smoke checks** for public feeds/signals/anomalies/market pages, admin settings, ingest, Buffer sync, realtime market tick, anomaly tick, cleanup, and outcome evaluation.
- [ ] **Step 5: Prepare cutover runbook** that freezes Mongo writes, disables GitHub schedules only after Cron verification, final-imports, deploys Postgres config, starts one scheduler, and retains Mongo read-only for rollback.
- [ ] **Step 6: Perform production cutover only with supplied Supabase credentials and an approved maintenance window**; expected: all app/jobs point to Postgres and GitHub scheduled workflows are inactive while GitHub CI remains enabled.
- [ ] **Step 7: Observe the rollback window**; expected: reconciliation/smoke checks remain clean, signal history stays present, and DB usage remains below the configured warning threshold.
- [ ] **Step 8: Retire Mongo only after explicit operational confirmation**; remove `MONGODB_URI` from runtime and retain an offline export per the runbook.
- [ ] **Step 9: Commit** `docs(ops): document Supabase cutover and rollback`.

## Final verification

- Run `npm run typecheck`, `npm test`, and `npm run build` after all implementation tasks.
- Run migration reconciliation against the selected target and attach its report to the cutover record.
- Confirm there are no runtime MongoDB imports/config dependencies outside the one-time importer and rollback tooling.
- Confirm signal history has no TTL/delete path, outcome rates exclude pending rows, and social-signal records cannot enter market signal/anomaly reporting.
- Confirm all production recurring jobs have exactly one active Supabase Cron schedule and GitHub CI workflows remain available.
