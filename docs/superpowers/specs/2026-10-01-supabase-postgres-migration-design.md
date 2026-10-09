# Supabase Postgres Migration Design

**Status:** Approved architecture; awaiting user review of this written spec  
**Date:** 2026-10-01  
**Repository:** `fayyazcode/cryptogram2.0`
**Branch at authoring:** `dev`

## Goal

Move the application from MongoDB to Supabase Postgres as its single source of truth. Use a staged, verifiable cutover: MongoDB remains available as a rollback snapshot while data and workloads are migrated, then becomes read-only and is retired after the new deployment is stable. Do not maintain permanent dual writes or split data ownership between the databases.

The migration covers the current application and job data: articles, stories, outbound social posts, automation runs, feed state, settings, login attempts, asset state, market snapshots, current market signals and outcomes, anomalies, news entities and impacts, AI analyses, and provider health. The schema should also support the planned tracked-X monitoring model: canonical accounts, deduplicated posts, post-to-asset mentions/evidence, and short-lived raw post text. X/sentiment-driven signals are a distinct scoring model from the current market signals and anomaly detector, even though they share the same Postgres database and can reference the same assets and post evidence.

## User requirements and constraints

- Use Supabase Postgres and Supabase Cron, initially targeting the Free plan.
- Stop relying on GitHub Actions schedules for recurring application jobs.
- RSS/article/story data follows the existing 30-day retention policy.
- Raw posts from monitored X accounts are deduplicated, associated with their author, and retained for 20 days; the author reference remains available to explain a signal.
- Signal events and their evidence/outcomes remain indefinitely for analytics. Evaluate bullish signals at 4 hours, 1 day, and 1 week, and report weekly, monthly, quarterly, and yearly success rates with clear sample counts and pending/matured status.
- Preserve the current site, admin, and API behavior while replacing the persistence implementation.
- Signal and anomaly functionality remains free and follows the current access model during this phase. A later subscription phase may put signal routes behind entitlement checks; this migration must preserve a clean server-side authorization boundary to support that later change, but must not add billing, paywalls, or subscription enforcement now.
- Keep three concepts distinct: current market-threshold signals, statistical market anomalies, and future X/sentiment-driven signals. Do not treat social sentiment outputs as anomalies or force their scores/prompts into the current market-signal schema.
- Do not let two schedulers perform the same job during cutover; job execution must be idempotent.

## Current system findings

- `src/lib/db.ts` is the common Mongo connection and collection registry. It currently exposes 15 logical collections and creates indexes from application code.
- Mongo-specific operations are spread through `src/lib/data/queries.ts`, `src/lib/data/intel-queries.ts`, auth rate limiting, admin actions, ingestion/cleanup/post jobs, market workers, and news correlation. A mechanical connection-string replacement is not sufficient.
- Existing scheduled entry points include API routes for ingest, daily posts, post sync, and cleanup. Realtime market processing has a bounded `REALTIME_ONCE` mode; anomaly processing is currently a CLI job. The scheduler migration therefore needs authenticated, bounded entry points for realtime, anomalies, and due outcome evaluation as well as the existing routes.
- `signals` currently has a Mongo TTL index on `expiresAt` (seven days). That index conflicts with the stated analytics requirement and must not be recreated in Postgres. Signal expiry should describe active display eligibility, not delete the historical event.
- Market snapshots, anomalies, and AI analyses currently have 30-day Mongo TTL indexes. Retention behavior should be made explicit during migration rather than assumed to carry over from Mongo indexes.
- GitHub workflow files currently run ingest, posting, sync, cleanup, realtime, and anomaly jobs. They should be disabled/removed only after equivalent Supabase Cron jobs are configured and verified.
- Current signal outcome types include one-hour and four-hour stages. The target extends these to four-hour, one-day, and one-week checkpoints; one-hour is not required in the target success-rate model unless product behavior needs it.

## Approaches considered

### A. Permanent split database

Keep editorial/RSS in MongoDB and move social monitoring, signals, and outcomes to Supabase. This reduces the first migration but creates cross-database joins, two sets of secrets/backups/monitoring, and awkward news/social/market evidence aggregation. Rejected as the target architecture.

### B. Direct all-at-once cutover

Rewrite the persistence layer and switch every workload in one release. This yields one database sooner, but creates a high-risk cutover with little opportunity to compare results and recover.

### C. Staged migration to one database — selected

Design and migrate the full schema, backfill MongoDB data, verify row counts and relationships, then switch all application reads/writes and scheduled workloads in a controlled cutover. Keep MongoDB frozen/read-only for rollback during a defined observation window, then retire it. There is no ongoing dual-write period.

## Target architecture

### Persistence layer

- Replace the Mongo client/collection API with a server-only Postgres data layer, using typed schema/migrations (Drizzle is the proposed implementation) and Supabase Postgres as the database host.
- Keep database access behind repository/query modules so pages, API routes, admin actions, and jobs do not issue ad hoc database calls. Existing route shapes and view models remain stable where possible.
- Keep signal/anomaly access policy at the API/service boundary rather than embedding it in the database schema. All current signal features remain free in this phase; future subscription enforcement can be added there without redesigning signal storage. Billing and subscription enforcement are out of scope for this migration.
- Use relational tables and foreign keys for articles/stories, posts/authors/assets, signal evidence/outcomes, and news links. Use JSONB only for provider-specific or versioned evidence payloads whose shape is intentionally flexible.
- Use stable UUID primary keys for new records and retain a unique `legacy_mongo_id` during migration where an ObjectId must be traced. Preserve natural unique keys such as article URL hash, story slug, X post ID, signal dedupe key, and AI input hash.
- Keep credentials server-side. Configure a pooled runtime connection for Vercel/serverless requests and a separate direct/migration connection only where Supabase requires it. Do not expose privileged database keys to the browser.

### Data domains

The initial relational schema will cover these domains:

1. **Editorial:** feed state, RSS articles, stories, and article/story relationships. Keep URL-hash deduplication, story slug uniqueness, categories, coin symbols, source coverage, publication times, summaries, and clustering fields.
2. **Publishing and operations:** outbound Buffer/social posts, automation runs, global settings, and short-lived login attempts. Preserve unique daily slot behavior and provider IDs.
3. **Market intelligence:** tracked assets, market snapshots, signal events, signal evidence, outcome checkpoints, anomalies, news-to-asset links, measured news impacts, AI analyses, and provider health.
4. **Tracked social sources:** monitored accounts, canonical account handles, deduplicated source posts, asset mentions, engagement observations, and references from social-signal evidence. Raw source-post content is purged after 20 days; historical signal evidence keeps durable post IDs, author handles, timestamps, URLs, and the derived evidence needed to explain a result, subject to source deletion/compliance requirements.

**Scoring boundaries:** (1) Existing market signals continue to use market thresholds and market evidence. (2) Anomalies continue to represent unusual market observations from the anomaly detector. (3) Future social signals use their own model version, prompt/schema, sentiment or hype-velocity dimensions, confidence, and cited post/author evidence. Main-coin social analysis can corroborate social mood with price, volume, and news; meme-coin analysis can emphasize mention growth, unique engaged accounts, and engagement spikes. Keep separate event tables or an equally strict discriminated schema so a social score cannot be mistaken for a market threshold score or anomaly. Sharing the asset/account/post foreign keys is expected; sharing scoring semantics is not.

Market signal events are immutable historical records. Each has separate checkpoint rows for 4h, 1d, and 1w with status, horizon, entry/end prices, return, favorable/adverse movement, volume/context fields, evaluation time, and reason. Pending checkpoints are excluded from matured success-rate denominators; dashboards show matured sample count alongside rates. Weekly/monthly/quarterly/yearly reporting is computed from retained market signal events and matured checkpoints, not from expiring market-snapshot rows alone. If/when social signals receive outcome evaluation, that result must be identified as its own model-specific evaluation and must not be blended into the existing market-signal success rate without an explicit product definition.

### Retention and scheduled cleanup

- RSS articles and stories: preserve the configured 30-day searchable window and existing cleanup grace behavior unless migration verification shows a specific dependency requiring adjustment.
- Tracked raw X post content: purge after 20 days. Keep only author/post references and derived historical signal evidence that remain permissible and useful.
- Signal events and outcome checkpoints: no TTL deletion.
- Market snapshots, anomalies, AI analyses, publishing records, login attempts, and automation runs: define explicit retention policies matching present behavior unless user requirements above supersede it. Convert Mongo TTL behavior to scheduled SQL cleanup, with a dry-run/count report before destructive cleanup is enabled.
- Cleanup must be chunked, observable, and idempotent; each run records counts and failures.

### Scheduler and job execution

- Supabase Cron becomes the only recurring scheduler after cutover. Cron jobs call authenticated Vercel API routes using a secret stored in Supabase Vault; routes invoke bounded application job functions using the Postgres repository layer.
- Add bounded authenticated entry points for realtime market ticks, anomaly detection, and due signal-outcome evaluation. Keep existing ingest, daily-post, Buffer sync, and cleanup entry points, adapting each to Postgres.
- Schedule jobs at their current required cadence unless the design/implementation plan identifies a runtime, quota, or provider-rate constraint. Ensure each run is idempotent and guarded against overlap using Postgres advisory locks or a durable job-run/lease table.
- The realtime Socket.IO server remains a separately hosted long-running process if live push is required; Supabase Cron triggers bounded persistence/market work and does not itself host a permanent socket server.
- GitHub scheduled workflows are disabled only after each replacement job has been run manually and its Cron schedule, authentication, and run history are verified. CI workflows can remain because they are not the production scheduler.
- Cron requests and worker failures are recorded in durable job-run rows and surfaced in admin diagnostics. Cron credentials are stored in Vault, not embedded in SQL source or client code.

## Migration and cutover

1. Inventory all Mongo queries/writes and document each table mapping, index/constraint, retention rule, and dependency before implementation.
2. Create versioned Postgres migrations and repository interfaces. Convert all web/API/admin/job reads and writes; preserve behavior and add database-level uniqueness/foreign-key rules.
3. Build a repeatable, resumable Mongo-to-Postgres importer. It copies every still-present document in batches, maps ObjectIds/relationships, preserves timestamps, and does not restore documents Mongo TTL has already deleted.
4. Reconcile source and destination counts by collection/table, required unique keys, foreign-key relationships, key dashboard/API query results, and sampled canonical hashes. Resolve discrepancies before cutover.
5. Pause all GitHub-scheduled and manual production jobs, freeze Mongo writes, run the final incremental import, configure secrets and Supabase Cron, then deploy the Postgres-backed application and start one scheduler.
6. Verify public pages, admin operations, feed ingest, Buffer sync, realtime market/signal writes, anomalies, cleanup, and signal outcome evaluation. Observe Cron run history and database size/quota.
7. Keep MongoDB read-only and retained for a documented rollback window. Rollback disables Supabase Cron, restores the Mongo-backed deployment and scheduler, and preserves Postgres data for diagnosis. After stable operation and explicit operational review, retire MongoDB and remove its credentials.

No permanent dual-write is used. If a write fails during cutover, the active system must report failure rather than silently sending the write to both databases.

## Free-plan constraints and operational risks

- Supabase documents the Free plan with 500 MB database size per project, no automatic backups, and project pausing after a week of inactivity. Signal history is unbounded by design, so database size must be measured and monitored; Free is an initial target, not a guaranteed long-term production tier.
- Configure a warning threshold well below the 500 MB read-only quota. If measured data plus expected growth cannot fit with headroom, stop before cutover and use a paid plan or a shorter/partitioned policy for non-signal history. Do not delete signal analytics to stay under quota.
- A free Cron feature does not make external providers, Edge Function invocations, or database capacity unlimited. Cron jobs should use bounded batches, avoid concurrent overload, and expose last-success timestamps.
- Supabase Free has no automatic backups; before cutover, export MongoDB and create a verified Postgres dump. Define the backup/restore operator steps before production cutover.
- Moving the database does not remove Vercel function-duration limits or make long-running jobs suitable for serverless calls. Measure execution time and keep routes bounded; move only workloads that exceed those bounds to a separately hosted worker.

## Security and observability

- Database access is server-only. Browser-facing access remains through existing app routes unless a later product decision explicitly introduces Supabase client access and row-level security.
- Cron endpoints require a high-entropy secret and constant-time comparison. Store the scheduler secret in Vault and Vercel environment configuration; never log it.
- Migrations are reviewed/versioned, applied explicitly, and are separate from page-request cold starts.
- Record job start/end/status, counts, errors, and scheduler trigger IDs. Do not store secrets or unnecessary raw social content in logs.

## Acceptance criteria

- Every current Mongo collection and supported new social-monitoring domain has an explicit Postgres table mapping, key constraints, and retention rule; market signals, anomalies, and social signals remain distinguishable in storage and analytics.
- Application pages, APIs, admin, and jobs run against Supabase Postgres without MongoDB at runtime.
- Migration is repeatable/resumable and reconciliation proves required records and relationships are preserved.
- RSS remains on its 30-day policy; raw tracked X content expires after 20 days; signal events and 4h/1d/1w outcomes remain indefinitely.
- Success-rate views show period, matured sample count, pending count, and rate without treating immature checkpoints as failures.
- Supabase Cron replaces production GitHub schedules and each job has authenticated invocation, overlap protection, run history, and a documented failure path.
- Free-plan storage and backup limitations are measured and acknowledged before production cutover.
- MongoDB is retained read-only for rollback during the observation period and removed only after stable verification.

## Out of scope

- Changing signal scoring formulas, sentiment prompts, asset identity verification, UI design, or business logic beyond what persistence requires.
- Moving the live Socket.IO service to Supabase.
- Using Supabase Auth or browser-direct database access; current app authentication/API boundary remains.
- Subscription plans, billing, and paywall enforcement. Existing signal and anomaly features remain free in this phase; future social-signal access is a separate product decision.
- Building the tracked-X collector, sentiment/hype scoring prompts, or social-signal UI. This migration provides a compatible schema foundation; those behaviors are a separate feature phase.
- Deleting GitHub CI or manual workflow dispatch functionality that is unrelated to recurring production schedules.

## Open implementation decisions

- Confirm actual Supabase Free database size headroom using live Mongo collection sizes before choosing a cutover date.
- Choose the exact paid/rollback observation window and take the production export before importing.
- Validate Supabase Cron, Vault, and `pg_net` availability and quotas for the selected project/region before turning off GitHub schedules.
- Determine whether currently retained Mongo data contains historical X posts; the current code has outbound Buffer posts but no tracked-X source-post collection, so that domain will be created for the planned social phase rather than backfilled from Mongo.
