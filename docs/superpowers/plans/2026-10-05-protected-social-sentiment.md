# Protected Social Sentiment and Supabase Rollout Plan

> **For agentic workers:** Follow the implementation method selected by the user after reviewing this plan. Do not apply database migrations or switch production traffic before the explicit cutover checks below.

**Goal:** Move RektoIQ to Supabase Postgres as its single runtime database and add an approved-member social sentiment workspace with profile management, deduplicated post references, separate social analysis, outcomes, and a Supabase Cron rollout.

**Architecture:** Build and version the full Postgres schema first, then migrate repositories and jobs in bounded domains while MongoDB remains the source of truth. Add member authentication/approval and the social domain behind server-side guards. Backfill and reconcile before a controlled cutover; Supabase Cron replaces GitHub production schedules only after matching jobs are verified. Keep public market signals/anomalies unchanged and separate from protected social signals.

**Tech stack:** Next.js App Router, TypeScript, Drizzle ORM, PostgreSQL/Supabase, Supabase Auth SSR, existing MongoDB driver for a resumable one-time importer, Supabase Cron/Vault/`pg_net`.

**Approved design:** `docs/superpowers/specs/2026-10-05-protected-social-sentiment-design.md`

**Base migration design:** `docs/superpowers/specs/2026-10-01-supabase-postgres-migration-design.md`

## Current Supabase state

- Connected project: `fayyazcode's Project` (`bzukscxbervodcfjqpco`), region `ap-southeast-2`, status `ACTIVE_HEALTHY`.
- The project currently has no `public` tables and no recorded migrations. No development branches exist.
- Security advisors currently return no findings (the project has no app schema yet).
- The Supabase plugin is connected; the local `.env.example` and `.env.local` do not define Supabase variables. Never print or commit key values.
- The application still uses MongoDB. Do not repoint runtime traffic to the empty Supabase project until schema, importer, reconciliation, secrets, and rollback steps are ready.

## Scope boundaries

- Existing public `/signals`, `/anomalies`, market pages, and current market scoring remain public and retain their behavior.
- The new `/sentiment` workspace and its APIs require verified email plus explicit admin approval.
- Admin approval keeps using the current environment-configured bootstrap admin session; members cannot self-approve or change roles.
- Keep tracked-X posts, social analyses, social signals, and social outcomes separate from outbound Buffer posts, market signals, and anomalies.
- Do not fabricate collection or analysis when X API credentials are unavailable. Collection remains `not_configured` until credentials and API access are set up.
- Do not disable existing GitHub scheduled jobs until equivalent Supabase Cron jobs have been manually verified after cutover.
- Do not add subscription billing or paywall logic.

## Work packages

This scope covers several subsystems. Implement the packages in order and keep each package deployable behind the current Mongo-backed runtime until cutover:

1. Postgres schema, connection setup, and migration workflow.
2. Repository conversion and Mongo import/reconciliation.
3. Supabase Auth, approval queue, and tracked-profile administration.
4. Social collection/analyzer interfaces, signal lifecycle, and protected UI.
5. Supabase Cron rollout and controlled database cutover.

## Package 1: Schema and database foundation

**Create:**

- `drizzle.config.ts`
- `src/lib/db/client.ts`
- `src/lib/db/schema/index.ts`
- `src/lib/db/schema/editorial.ts`
- `src/lib/db/schema/operations.ts`
- `src/lib/db/schema/intelligence.ts`
- `src/lib/db/schema/social.ts`
- `drizzle/0000_initial_schema.sql` (reviewed/generated migration)
- `scripts/db/check-schema.ts` (read-only schema inventory helper)

**Modify:** `src/lib/db.ts`, `.env.example`, `package.json`, `package-lock.json`, `README.md`, `DEPLOYMENT.md`.

1. Inventory every collection, query, write, unique key, TTL index, and call site in `src/lib/db.ts` and its callers. Record the inventory alongside the migration docs before converting any caller.
2. Add Drizzle and PostgreSQL dependencies and a server-only connection module. Runtime uses a pooled `DATABASE_URL`; migration tooling accepts a separate `DATABASE_MIGRATION_URL`. Validate missing/invalid config with a clear server-side error and never fall back silently to Mongo after cutover.
3. Define typed tables for all current Mongo domains: articles, stories, story/article links, feed state, settings, outbound Buffer posts, job runs, login attempts, assets, market snapshots, market signals, signal evidence, outcome checkpoints, anomalies, news entities/impacts, AI analyses, and provider health.
4. Define social tables separately: member profile/approval metadata, tracked X accounts and groups, X posts, asset mentions, engagement observations, analyses, social signals, evidence links, outcomes, per-account cursors, and durable job runs.
5. Encode uniqueness and foreign keys in Postgres. Required dedupe keys include article URL hash, story slug, Buffer provider ID/slot, market signal dedupe key, and `(platform, platform_post_id)` for inbound X posts.
6. Keep raw inbound post text in one column with an explicit 20-day purge policy. Signal/evidence history persists without a second raw-text copy. Signal/outcome tables have no TTL cleanup.
7. Review generated SQL for RLS/grants, index coverage, retention and referential behavior. The schema migration must be repeatable in source control and include the exact 16 account seeds once, conflict-safely, with documented group memberships.
8. Add safe setup docs listing required variable names only: Supabase URL, publishable key, server secret, pooled DB URL, migration URL, and later X/AI/SMTP/Vault settings. No secret values in committed files.

**Interfaces:** `getDatabase(): NodePgDatabase<typeof schema>`; repository modules import the typed `schema` barrel. Only server modules may import the DB client. No page or API route talks directly to the Mongo client after a domain has migrated.

## Package 2: Repository migration and resumable data import

**Create:** `src/lib/data/repositories/{editorial,operations,ingestion,publishing,intelligence,signal-outcomes}.ts`, `scripts/db/import-mongo.ts`, `scripts/db/reconcile-mongo.ts`.

**Modify:** `src/lib/data/queries.ts`, `src/lib/data/intel-queries.ts`, `src/lib/settings.ts`, `src/lib/auth/rate-limit.ts`, admin actions/pages, every `src/lib/jobs/*` module, market/signal/anomaly modules, `scripts/*worker*`, `scripts/news-correlation.ts`, and the existing cron API route handlers that persist data.

1. Preserve current query return types and page/API contracts while moving one domain at a time to parameterized Postgres repository functions.
2. Convert editorial and operations reads/writes first, followed by ingestion/publishing, then market intelligence/outcomes. Keep existing market signal and anomaly semantics unchanged.
3. Build a client-side importer that reads from Mongo and writes bounded batches to Postgres. Persist collection/cursor progress; reruns must be idempotent and safe after partial failure. Preserve source IDs in `legacy_mongo_id` fields and map relationships explicitly.
4. Add dry-run and reconciliation output for source/destination counts, unique natural keys, unresolved foreign keys, and sampled canonical hashes. Do not delete or mutate Mongo records during import.
5. Convert scheduled job persistence to repositories. Existing GitHub workflows remain operational during this phase and remain the production scheduler until cutover.
6. Add runbook steps for final Mongo write freeze, incremental import, reconciliation, deploy, rollback, and Mongo read-only observation. Do not use permanent dual writes.

**Interfaces:** Keep current query/service signatures stable where practical. Importer commands expose explicit `--dry-run`, `--resume`, and `--collection` options, and report counts without logging secrets or raw user content.

## Package 3: Authentication, approvals, and tracked profiles

**Create:** Supabase SSR client/server utilities; signup, login, callback, pending, rejected/revoked, recovery, and logout routes/pages; `/admin/access`; `/admin/profiles`; `requireApprovedMember()` guard; profile/approval server actions and repository functions.

**Modify:** admin navigation/layout and environment/setup documentation.

1. Add Supabase Auth email/password flows using secure server-side cookies. Email verification is required before a signup request can be approved.
2. Store member approval (`pending`, `approved`, `rejected`, `revoked`) separately from auth identity. Recheck approval on every protected page/API/server action; do not rely on a stale JWT role claim.
3. Keep the current env-configured `requireAdmin()` bootstrap path as the only administrator source. Add admin actions to approve, reject, and revoke, recording actor/time.
4. Seed and manage the 16 supplied profiles. Accept either a normalized handle or X profile URL; enforce uniqueness; support add/edit/remove and multiple groups. Removing a profile stops collection but preserves historical signal attribution.
5. Add RLS and grants that deny unauthenticated access and prevent members from editing approval or profile configuration. Pair database policies with server authorization checks.
6. Document production custom SMTP and Auth redirect configuration. Do not claim production email delivery works until SMTP is configured and verified.

**Interfaces:** `requireApprovedMember()` returns the verified member identity or redirects/throws a typed authorization error. Every `/api/sentiment/*` handler calls the same guard before repository access.

## Package 4: Social pipeline, outcomes, and protected workspace

**Create:** provider/model interfaces and adapters under `src/lib/social/`; versioned major-coin and on-chain/meme prompts/schemas; `/sentiment` pages/components; `/api/sentiment/*`; admin social operations status view.

**Modify:** asset administration/identity mapping and market/news repository read interfaces only where corroborating evidence needs them.

1. Add an X provider interface and gated implementation. Missing `X_API_BEARER_TOKEN` reports `not_configured` and returns no posts/signals. Use durable per-profile cursors, bounded fetches, provider rate-limit handling, and idempotent upsert by platform post ID.
2. Preserve post owner handle, canonical URL, published timestamp, metrics observation time, and foreign key. Purge only raw text after 20 days; keep permitted compact derived evidence and references.
3. Add token identity resolution requiring chain plus contract for on-chain assets. Use a provider adapter for pair metadata (initially DexScreener); ambiguous mentions remain unassigned and cannot emit an asset signal.
4. Implement strict separate output schemas: major-coin analysis corroborates mood with volume/news; on-chain/meme analysis emphasizes sentiment, narrative, mention acceleration, unique engaged authors, and engagement spikes. The momentum group informs hype measurements but cannot create a directional signal alone.
5. Derive descriptive `rising`, `exploding`, `cooling`, and `fading` labels from observed time series with minimum-volume floors. Do not label these as trade recommendations.
6. Store each social signal with model/schema/formula versions, confidence/uncertainty, measurements, and multiple evidence references. Keep current public market-signal/anomaly APIs isolated.
7. Evaluate social outcomes at 4h/1d/1w with explicit success/failure/mixed/not-evaluated rules finalized before UI rates are shown. Pending checkpoints are excluded from matured success denominators. Show weekly/monthly/quarterly/yearly sample counts, matured and pending counts. Keep social and market rates separate.
8. Build responsive protected Main coins and On-chain/Meme dashboard views, signal detail/evidence pages, empty/not-configured states, and clear retention notices when post text expires.

**Interfaces:** Provider interface exposes bounded account-post fetch and health/cursor state; analyzer returns validated discriminated major/meme schemas; signal persistence receives resolved chain+contract identity and source post IDs, never only a ticker or name.

## Package 5: Cron and controlled cutover

**Create:** authenticated bounded job routes for social collection, due social outcomes, and post-text cleanup; reviewed SQL/template for Supabase Cron schedules and Vault secret setup; operator runbook.

**Modify:** existing market/realtime/anomaly/outcome job routes and GitHub workflow schedule configuration only when cutover has passed verification.

1. Verify `pg_cron`, Vault, and `pg_net` availability and project quotas. Store the high-entropy route secret in Vault and Vercel server environment, never in source SQL or browser code.
2. Create bounded HTTP schedules for existing replacement jobs and social collection every two hours, outcomes, and daily content cleanup. Use durable job leases/advisory locks and observable run history.
3. Manually invoke each new route and confirm authentication, bounded duration, idempotency, persisted run status, and failure visibility before creating recurring schedules.
4. Measure database size, backup/restore, SMTP, and provider quotas. Free-plan 500 MB storage/no automatic backup limits must be considered before cutover; stop if there is insufficient headroom.
5. Freeze Mongo writes, run final incremental import, reconcile counts and relationships, deploy the Postgres-backed app, then enable the verified Supabase schedules.
6. Disable GitHub production schedules only after each Supabase replacement succeeds. Keep GitHub CI/manual workflows that are not recurring production schedules.
7. Observe a documented rollback window with Mongo read-only. Rollback disables Supabase schedules and deploys the prior Mongo-backed release. Retire Mongo only after stable operations and an explicit operational review.

## Security and data safeguards

- No service-role/secret key in client bundles, logs, or committed files.
- No database or cleanup operations during page requests.
- No destructive cleanup during import or cutover. Retention jobs are bounded, observable, and dry-run/countable before enabling.
- Public signal/anomaly routes cannot accidentally join or return protected social data.
- No X or AI credential means no fabricated posts, analyses, or signals.
- No success-rate claim without mature sample count and explicit horizon semantics.

## Review/implementation gates

1. User reviews this phased plan and selects execution style: subagent-driven implementation or one agent executing it inline.
2. Before any hosted schema mutation, confirm this connected project is the intended environment and apply only the reviewed migration SQL from the repo.
3. Before application cutover, verify importer reconciliation, required secrets/SMTP, DB headroom, backup/restore, job schedules, and rollback procedure.
4. Do not push or deploy as part of this plan unless explicitly requested after the local result is reviewable.

## Verification constraints

- Keep verification scoped to user-authorized implementation and report the exact commands/results when run.
- Do not add or run automated tests unless the user asks to test or verify.
- Before cutover, use database schema inspection, importer dry-run/reconciliation, and the operator's manual acceptance steps as specified above.
