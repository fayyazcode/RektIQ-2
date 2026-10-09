# Protected Social Sentiment Workspace Design

**Status:** Draft for user review  
**Date:** 2026-10-05  
**Repository:** `fayyazcode/cryptogram2.0`
**Branch at authoring:** `dev`

## Goal

Build a protected social sentiment and hype-monitoring workspace for the 16 X profiles supplied by the user, with a signup-request and administrator-approval flow. Complete the application-side data model, access controls, management UI, analysis pipeline, score/outcome logic, dashboard, and scheduler integration without requiring an X API credential during implementation. Live X post collection remains disabled until the user supplies an eligible X API credential and configures it in production.

Use Supabase Postgres as the single application database, following the approved migration direction in `2026-10-01-supabase-postgres-migration-design.md`. This design adds member authentication and social-monitoring behavior to that migration. It supersedes the earlier migration spec's exclusions for Supabase Auth and the social collector/UI. The existing environment-configured admin login remains the owner/bootstrap account. Current market signals and anomalies remain public and free; only the new social sentiment workspace requires an approved member account. Do not add subscriptions, billing, or a paywall.

## User requirements

- Members request access with email and password, verify their email, then wait for an administrator to approve them.
- Administrators can approve, reject, and revoke member access from the existing admin area.
- Provide a dedicated, responsive X-profile management page seeded with the supplied profiles. Profiles can belong to one or more groups: `majors`, `onchain`, and `momentum`.
- The `stogolp`, `blknoiz06`, and `owen1v9` profiles belong to both `majors` and `onchain`. `based16z` belongs to `momentum`.
- Keep current market signals/anomalies separate from social sentiment signals in routes, schemas, scoring explanations, and analytics.
- Major-coin social analysis combines social mood with market volume and relevant news. On-chain/meme analysis emphasizes sentiment, mention velocity, unique engaged authors, and engagement spikes.
- Use AI output with references to the source profile and post. Use distinct prompts and validated output schemas for the major-coin and on-chain/meme models.
- Store each X post once by platform post ID, associate it with its owner handle and source URL, and remove raw post text after 20 days. Keep signal events, outcomes, and aggregate performance history indefinitely.
- Evaluate social signals at 4 hours, 1 day, and 1 week. Report weekly, monthly, quarterly, and yearly performance with matured sample counts; do not count pending checkpoints as failures.
- Use Supabase Cron for recurring work after the Mongo-to-Supabase migration. Do not rely on GitHub Actions schedules for production jobs.
- Do not generate fake or placeholder social signals when the X API is unavailable. Show honest empty, paused, and configuration-needed states.

## Existing system findings

- The app currently uses MongoDB for editorial data, settings, admin operations, market intelligence, and existing signals. The all-data Supabase migration is not implemented yet.
- Admin access is one environment-configured username/password with a signed `cg_session` cookie. There are no member accounts, signup route, access-request queue, or approval status.
- Public `/signals` and `/anomalies` pages read public API endpoints. They must keep their current access model.
- The current profile-management request has no collector or social signal runtime in the repository. The existing `social_posts` collection is for outbound Buffer posts and must not be reused for monitored X posts.
- The market score and signal worker is independent of X; social scoring must not change its formula or historic result labels.
- Supabase Cron uses `pg_cron` and can call database functions or make HTTP requests, including invoking an Edge Function. Jobs must remain bounded, idempotent, and observable. Supabase's current free-plan database size limit is 500 MB; measure actual migrated data and growth before production cutover. See [Supabase Cron](https://supabase.com/docs/guides/cron) and [database-size limits](https://supabase.com/docs/guides/platform/database-size).

## Approaches considered

### A. Unified Supabase migration — selected

Migrate existing application data and jobs to Supabase Postgres, then store member access, profiles, X posts, analyses, social signals, and outcomes there as well. This follows the user's prior decision to migrate the application and avoids permanently split ownership, duplicated access controls, and cross-database analytics.

### B. Hybrid databases

Keep existing app data in MongoDB while adding Supabase for auth and social data. This reduces initial migration work but adds two production databases and complicates joins and operations. This is not the target architecture.

### C. MongoDB-only social module

Add a custom member/auth system and social data collections to MongoDB. This may shorten initial setup but reverses the approved Supabase migration decision and duplicates authentication work that Supabase Auth already supports. This is not the target architecture.

## Target architecture

### Authentication and approval

- Use Supabase Auth email/password for members and the server-side Next.js cookie/session integration documented by Supabase. Require email confirmation before a request can be approved.
- Add an application `member_profiles` row linked to `auth.users`, with `approval_status` (`pending`, `approved`, `rejected`, or `revoked`), `role` (`member`), created/updated timestamps, and approval audit fields. A signup creates a pending row; it grants no protected-data access.
- Keep the existing environment-configured admin login as the bootstrap administrator. Do not create a second way to self-assign the administrator role. Admin approval and profile-management actions continue to call the server-side `requireAdmin()` guard.
- Add an Admin → Access page that lists pending requests and lets the administrator approve, reject, or revoke a member. Record who made each decision and when. Revocation takes effect on the next protected request; do not rely only on a long-lived role claim in a JWT.
- Add member signup, login, email-confirmation, pending/rejected/revoked, and logout screens. Password recovery uses Supabase Auth email delivery.
- Supabase's default email service is for development: it only delivers to team addresses and is limited to 2 messages per hour. Production signup confirmation and password recovery require user-configured custom SMTP. This is a deployment dependency, documented in setup instructions, not a reason to embed mail credentials in code. See [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp).
- Add a reusable server guard such as `requireApprovedMember()` and apply it independently to every protected page, server action, and API route. An unauthenticated visitor is sent to sign in; a pending user sees a pending-approval page; a rejected/revoked user is denied.
- Supabase `service_role`/secret keys remain server-only and are used only by narrowly scoped admin or worker operations. Never expose them in browser bundles. Enable RLS and explicit grants/policies for all exposed tables; RLS must not be the only security layer around privileged keys. See [Supabase RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security).

### Routes and access boundaries

- Preserve `/signals`, `/signals/[id]`, `/anomalies`, their existing APIs, and the public asset pages as free routes.
- Add a member-only `/sentiment` workspace with separate **Main coins** and **On-chain / Meme coins** views. The page explains evidence, labels, and model-specific score components; it never describes a score as a trade recommendation.
- Add protected `/api/sentiment/*` endpoints for social signal lists, signal details, tracked-post references, and dashboard analytics. Every route calls the approved-member guard before returning data.
- Keep administrative user approvals and profile/asset configuration under `/admin/*`, protected by the existing admin session.
- Public current-signal APIs must not expose social posts or social signal records as a side effect of reusing a shared query.

### Profile and asset management

- Add Admin → X Profiles with the 16 supplied accounts, normalized X handles, group badges, add/edit/remove controls, duplicate detection, and input normalization from either a handle or `x.com` profile URL.
- Store group membership as a list so a profile can serve both `majors` and `onchain` monitoring. Do not infer groups from handle strings.
- Seed exactly these unique profiles and group assignments:

| Handle | Groups |
| --- | --- |
| `insomniacxbt` | majors |
| `lBattleRhino` | majors |
| `captain_kole` | majors |
| `_tolks` | majors |
| `Tradermayne` | majors |
| `stogolp` | majors, onchain |
| `Evan_ss6` | majors |
| `ThinkingUSD` | majors |
| `smileycapital` | majors |
| `blknoiz06` | majors, onchain |
| `0xRenaissance` | onchain |
| `0xuberM` | onchain |
| `notanicecat69` | onchain |
| `owen1v9` | majors, onchain |
| `0xn4te` | onchain |
| `based16z` | momentum |

- Add/retain asset identity fields for provider ID, symbol, chain, and contract address. For on-chain assets require chain plus contract address before collecting or attributing social mentions. Resolve/validate DEX pair metadata through a provider adapter (DexScreener may be the initial adapter); never identify a meme coin by name or ticker alone. A low-confidence or ambiguous mention is shown as unassigned evidence and cannot create an asset signal.
- Removing a profile stops future collection from it. Previously created signals and outcomes remain. Raw post deletion and any required provider deletion requests follow the documented retention process.

### Social data and processing

- Use distinct Postgres tables for monitored profiles, inbound X posts, asset mentions, AI analyses, social signals, signal evidence references, signal outcome checkpoints, and job runs. Keep outbound Buffer posts in their existing domain/table mapping.
- `x_posts` has a unique `(platform, platform_post_id)` key. Re-polling a post updates its permitted engagement snapshot but never inserts a duplicate. Store the author/profile foreign key, published time, canonical URL, language, metrics observed time, and raw text.
- Keep raw text only for the requested 20-day window. Purge text in bounded cleanup batches. Signal evidence keeps durable post ID, author handle, post URL, timestamp, analysis/model version, and compact derived evidence needed for historical explanation; it must not retain a second full raw-post copy.
- Process only new/updated posts since each profile's cursor with bounded pagination and provider rate-limit handling. Resume from a durable per-profile cursor so failed batches can retry without gaps or duplicate rows.
- Add a source-provider interface with a real X API adapter controlled by a server-side credential. When no X credential exists, health state says `not_configured` and scheduled collection skips cleanly; the UI shows setup guidance and no generated output.
- Add separate, versioned AI prompt and JSON schema contracts:
  - **Major coins:** sentiment, direction, confidence, sarcasm/irony/humor assessment, evidence links, uncertainty, market volume/context, and related news evidence.
  - **On-chain / meme coins:** sentiment, narrative, hype velocity, mention acceleration, unique engaged authors, engagement spikes, liquidity/market confirmation, identity confidence, evidence links, and uncertainty.
  - **Momentum profile group:** its posts contribute to hype velocity and engagement evidence but do not by themselves create a bullish/bearish signal.
- Store provider, model name, prompt/schema version, source post IDs, created time, raw structured response (only where useful and retention-safe), and validated normalized output. Provider/model selection is configuration-driven; the design does not bind to an API model that may change before credentials are available.
- Derive labels such as `rising`, `exploding`, `cooling`, and `fading` from measured mention/engagement time series, with a minimum-volume floor and explicit comparison window. Labels are descriptive momentum states, not trade directions.
- Use a separate social score/signal schema and formula version from current market signals and anomalies. A signal references multiple supporting posts/authors and explains the actual measurements behind it.

### Outcomes and analytics

- Social-signal outcomes have independent 4-hour, 1-day, and 1-week checkpoints, with entry price, end price, return, favorable/adverse excursion, relevant market/volume context, sample coverage, evaluated time, and a clear reason for each status.
- Keep market-signal and social-signal outcomes in separate report groups and never blend denominators or success rates. Immature/pending outcomes are excluded from matured rates; show their count separately.
- Keep signal and outcome records indefinitely. Compute weekly, monthly, quarterly, and yearly summaries with sample count, matured count, pending count, and success/fail/mixed/not-evaluated counts. Define success/failure thresholds in the implementation plan before adding any performance claim to the UI.
- Data retention does not imply that expired posts remain readable: historic signal views show author/time/link and derived evidence, and clearly indicate when the original post text has expired or is no longer available.

### Scheduler and observability

- After the all-data cutover, Supabase Cron is the sole production scheduler. Cron calls authenticated, bounded server job entry points as defined in the approved database migration design; it does not run duplicate GitHub schedules.
- Use Supabase Cron HTTP jobs to invoke the app's authenticated Node/Vercel job routes, rather than putting the full AI collection batch in one Supabase Edge Function. Process profiles in bounded resumable batches. If any small task does use a Free-plan Edge Function, keep it below the documented 150-second wall-clock limit.
- Run X collection on the requested 2-hour cadence, due checkpoint evaluation often enough to meet its horizons, and post-text cleanup at least daily. Separate job identities and locks prevent overlapping batches.
- Persist per-profile cursors, job run start/end/status, inserted/updated/duplicate/error counts, last successful poll, provider rate-limit state, and missing-credential state. Show these on the admin social operations view.
- Jobs are idempotent and resumable. API rate limits, model timeouts, or provider errors do not discard fetched posts or create empty/false signals. Failed work is retried with bounded backoff and surfaced to the administrator.
- Supabase Cron and database usage are measured on the chosen project/plan before retiring MongoDB. Current Supabase Cron supports scheduled SQL and HTTP/function calls; each job should remain within documented runtime guidance. [Supabase Cron](https://supabase.com/docs/guides/cron).

## Migration and rollout

1. Extend the all-data Postgres schema and migration inventory with member access, profile groups, token identities, inbound posts, sentiment analyses, social signals, evidence references, checkpoints, and per-profile/job cursors.
2. Keep the existing admin login operational while importing current MongoDB data. Do not expose new member routes until the Supabase project, tables, RLS policies, secrets, email redirects, SMTP, and initial administrator access have been configured.
3. Run repeatable migrations and reconcile all legacy collection counts and key relationships before any cutover. Seed the 16 profiles exactly once using conflict-safe migrations.
4. Deploy protected pages in an unconfigured state; verify signup, email confirmation, pending approval, approval, denial, revocation, session refresh, and direct API access checks without X collection.
5. Configure and manually verify Supabase Cron job invocations and run histories. Disable GitHub production schedules only after each replacement schedule is verified, per the base migration spec.
6. When the user supplies X credentials, configure the server secret, confirm the endpoint/plan has the required recent user-post fields and public engagement metrics, perform a small single-profile ingestion, validate dedupe/attribution/retention, then enable the full 2-hour schedule.
7. Enable AI analysis only after the post-ingestion stage is verified; enable social-signal emission only after model/schema validation and evidence references are verified. Keep the UI in not-configured/empty mode before those steps.
8. The full Mongo cutover and rollback observation window follow the approved migration spec. No permanent dual-write mode is introduced.

## Security and privacy

- Signup never grants data access. Approval status is checked server-side on every protected request, including APIs and server actions.
- Only the bootstrap admin can approve/revoke users or edit tracked profiles. A member cannot change their own approval or role.
- Passwords are managed by Supabase Auth, not stored in application tables. Auth/session cookies are HTTP-only and secure in production.
- RLS policies, grants, and server guards are reviewed together. Service-role credentials stay server-side and are never used from browser clients.
- Do not log password, bearer token, raw email confirmation link, full private prompt payload, or raw post text. Keep X source links and user handles as the source attribution expected by the product.
- Raw source text expires after 20 days, but signal records remain. Implement deletion/update handling for source-post removal where required by the provider's developer terms before enabling live ingestion.

## Acceptance criteria

1. The 16 requested X profiles are present once with the documented groups, and administrators can add, edit, and remove profiles without code changes.
2. New users can register and confirm email, but remain blocked from protected content until an administrator approves them.
3. Admins can approve, reject, and revoke access; revocation blocks both pages and APIs on the next request.
4. Current `/signals` and `/anomalies` routes and APIs continue to work publicly and retain their existing market/anomaly semantics.
5. The new sentiment dashboard and every `/api/sentiment/*` endpoint reject logged-out, pending, rejected, and revoked users.
6. Main and On-chain/Meme views use distinct validated analysis schemas, show evidence links/handles and honest confidence/uncertainty, and never show fabricated output.
7. No ambiguous meme-coin ticker or name alone can attach a post to a token contract or emit a token signal.
8. A repeated platform post ID remains one stored post; per-profile cursor retries are idempotent.
9. Raw post text is removed after 20 days, while social signals and checkpoint history remain available for aggregate analytics without retaining duplicate full text.
10. Social outcomes are independently evaluated at 4h/1d/1w and social rates are never blended with current market-signal rates. Aggregate periods show matured sample counts and pending counts.
11. With no X credential, the provider reports `not_configured`, the job skips without false success, and the dashboard clearly explains the missing integration.
12. Supabase Cron is the only recurring production scheduler after cutover, with durable run history, overlap protection, and a verified rollback path.
13. All application persistence runs on Supabase Postgres after cutover; MongoDB is retained only as a read-only rollback snapshot during the observation window and is retired after reconciliation.

## Out of scope

- Subscription billing, paid access tiers, or changes to the free access policy for current market signals and anomalies.
- Live X collection before the user provides valid API credentials and the needed API access plan.
- Posting to X, following/engaging with tracked accounts, or any write operation to X.
- Changing the market-only signal formula, anomaly detector, or public route behavior.
- Guaranteeing model interpretation of humor, sarcasm, or intentionally misleading claims. The model must report uncertainty and cite the post evidence instead of treating interpretation as fact.

## User-visible setup dependencies

- Supabase project URL and publishable key for the cookie-based Auth client; privileged secret key and Postgres connection only in server/job environments.
- Custom SMTP credentials and approved Auth redirect URLs for production member confirmation and password recovery. Supabase's default SMTP is restricted to team recipients and currently limited to two messages per hour; see [custom SMTP requirements](https://supabase.com/docs/guides/auth/auth-smtp).
- X API bearer credential and a plan with access to the account timeline fields/metrics needed by this design. The exact endpoint and quota must be checked against the user's selected X plan before enabling collection.
- AI provider/model credentials and cost/rate limits. Keep provider/model choice configurable; do not assume that credentials used by the current news pipeline are sufficient for the social volume or interpretation quality.
- Current Mongo database size and Supabase project quotas must be checked before migration/cutover. Supabase Free projects become read-only beyond 500 MB database size; see [database size limits](https://supabase.com/docs/guides/platform/database-size).

## References

- [Supabase Auth with Next.js](https://supabase.com/docs/guides/auth/quickstarts/nextjs)
- [Supabase SSR Auth](https://supabase.com/docs/guides/auth/server-side)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
- [Supabase Cron](https://supabase.com/docs/guides/cron)
- [Base Supabase migration design](2026-10-01-supabase-postgres-migration-design.md)
