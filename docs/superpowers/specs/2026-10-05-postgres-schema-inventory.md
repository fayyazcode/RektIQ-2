# Postgres schema inventory

This inventory records the current MongoDB collections and the local Postgres foundation mapping before any application caller is converted. The SQL migration in `supabase/migrations/20261005120000_initial_schema.sql` is authoritative for constraints, indexes, retention comments, RLS, and seed data. This file does not imply the migration has been applied to the hosted project.

## Existing MongoDB domains

| Mongo collection | Postgres table(s) | Key constraints and indexes | Retention behavior |
| --- | --- | --- | --- |
| `articles` | `app.articles` | Unique URL hash; source/GUID, title hash, publication indexes | Preserve current article cleanup policy; no database TTL is applied in this foundation. |
| `stories` | `app.stories`, `app.story_articles` | Unique slug; link PK; recent, score, category and coin lookup indexes | Preserve current story cleanup policy; no TTL is applied here. |
| `social_posts` (Buffer output) | `app.outbound_posts` | Unique non-null Buffer ID and daily slot; status/schedule indexes | Existing app cleanup policy; no TTL is applied here. |
| `automation_runs` | `app.automation_runs` | Kind/start and start-time indexes | Existing app cleanup policy; no TTL is applied here. |
| `feed_state` | `app.feed_state` | Source ID primary key | Retain current operational state. |
| `settings` | `app.global_settings` | Singleton key; JSONB preserves current configurable fields | Retain current settings. |
| `login_attempts` | `app.login_attempts` | UUID key; attempt time and IP indexes | Existing 15-minute Mongo TTL must be replaced by a bounded cleanup job; none is enabled here. |
| `assets` | `app.assets` | Legacy key; provider ID; case-insensitive chain/contract identity; symbol/score indexes | Retain current asset state. |
| `market_snapshots` | `app.market_snapshots` | Symbol/sample-time and ingestion-time indexes | Existing 30-day Mongo TTL must be implemented by explicit cleanup; none is enabled here. |
| `signals` | `app.market_signals`, `app.market_signal_evidence`, `app.market_signal_outcomes` | Unique dedupe key; symbol/type time indexes; unique signal/horizon | No TTL: historical events and outcomes are retained for analytics. `expires_at` controls active display eligibility only. |
| `anomalies` | `app.anomalies` | Unique dedupe key; symbol/type time indexes | Existing 30-day Mongo TTL must be implemented by explicit cleanup; none is enabled here. |
| `news_entities` | `app.news_entities` | Unique article/symbol; symbol/publication index | Retain according to article relationship cleanup. |
| `news_impacts` | `app.news_impacts` | Unique article/symbol; symbol/publication index | Retain according to article relationship cleanup. |
| `ai_analyses` | `app.ai_analyses` | Unique input hash; ref lookup | Existing 30-day Mongo TTL must be implemented by explicit cleanup; none is enabled here. |
| `provider_health` | `app.provider_health` | Provider ID primary key | Current provider-health state is overwritten by provider. |

## New member and social domains

| Purpose | Postgres table(s) | Persistence and safety properties |
| --- | --- | --- |
| Signup approval state | `app.member_profiles` | FK to Supabase `auth.users`; only member role; pending by default; decision audit fields. Approval must be checked on every protected request. |
| Profile/group management | `app.tracked_accounts`, `app.tracked_account_groups` | Case-normalized unique handle; explicit many-to-many `majors`, `onchain`, `momentum` groups; repeatable 16-profile seed. |
| Inbound post dedupe | `app.social_posts` | Unique `(platform, platform_post_id)`; author handle and source URL remain as durable references; raw text has an explicit expiry timestamp and 20-day retention comment. |
| Token references | `app.assets`, `app.social_asset_mentions` | Social mentions reference a UUID asset and matching chain/contract identity. On-chain attributions/signals require a verified chain+contract pair enforced by checks and composite foreign keys; unresolved/ambiguous mentions can remain unassigned. |
| Engagement history | `app.social_engagement_observations` | Unique observation timestamp per post; stores available public engagement counts and unique-engager count. |
| Separate social model | `app.social_analyses`, `app.social_analysis_evidence`, `app.social_analysis_signals`, `app.social_signals` | Distinct `majors`/`onchain` model kind, model/prompt/schema/formula versions, provider/model provenance, analysis-to-post references, analysis-to-signal links, dimensions, confidence, and score. Not merged with market signal or anomaly tables. |
| Durable signal evidence | `app.social_signal_evidence` | Captures post ID, author, canonical URL, time, summary, and derived metadata without storing a duplicate of raw post text. |
| Outcomes and analytics source | `app.social_signal_outcomes` | Independent 4-hour, 1-day, 1-week horizons; pending status, evaluated sample count, and observed coverage minutes are explicit; no TTL. |
| Collection/job progress | `app.tracked_account_cursors`, `app.worker_job_runs` | Durable cursor, error, lease, batch, and run status for resumable jobs. |

## Security boundary

The application data lives in the non-default `app` schema. The migration enables RLS on each app table, revokes browser roles and `PUBLIC`, and grants the Supabase `service_role` schema/table access for server-side worker use. The schema is not added to the Data API exposed-schema setting by this migration. Current app routes remain responsible for member/admin approval checks; RLS is defense in depth and no browser key or database credential is stored in this repository.

No retention task, schedule, migration application, or hosted database mutation is performed by Package 1. The explicit retention jobs and rollout are later packages.
