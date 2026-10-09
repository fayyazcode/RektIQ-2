# v2 rebuild: what changed and why

## Unreleased: live crypto intelligence layer (Phases 0–5)

- **Phase 1 — Market data:** `src/lib/market/` adds a `MarketProvider` abstraction with CoinGecko as the first adapter (`coingecko.ts` normalizes every response into an internal `AssetSnapshot` shape carrying timestamp + provider). `service.ts` is the single funnel for all market data (TTL cache, single-flight de-dup, 429 back-off, stale-while-error fallback, health tracking in `health.ts`). Browsers never call providers directly.
- **Phase 2 — Database:** intelligence tables — `assets`, `market_snapshots`, `signals`, `anomalies`, `news_entities`, `news_impacts`, `ai_analyses`, `provider_health` (`src/lib/intel-types.ts`), with indexes on symbol+timestamp / asset+timestamp / signal-type+timestamp / news-entity+timestamp. The current schema is managed by Supabase SQL migrations.
- **Phase 3 — Deterministic score:** `src/lib/score/engine.ts` implements the versioned 0–100 Crypto Live Score (`score-v1`; momentum 25 · volume acceleration 20 · liquidity 15 · volatility 10 · market-cap context 10 · moving-average relation 10 · news/social 10). Pure functions, input validated with Zod, reproducible from identical input, unit-tested.
- **Phase 4 — Signals:** `src/lib/signals/engine.ts` emits `{ symbol, type, score, evidence, timestamp, expiresAt, formulaVersion }` events only on meaningful threshold crossings; duplicates are suppressed both in logic (zone-change rules, one event per tick) and in PostgreSQL (unique `dedupeKey`). Fixed a bug where a same-zone re-cross could re-emit a duplicate of an active signal.
- **Phase 5 — Anomalies:** `src/lib/anomalies/engine.ts` compares current values against trailing baselines (volume, price movement, volatility, liquidity, market cap, news activity); nothing is called anomalous without a defined baseline, and each anomaly records observed/baseline/ratio/window.
- Housekeeping: `.gitignore` restored (build artifacts) plus `node_modules/` and `.next/` removed from git tracking (files stay on disk).

## Unreleased: hosting moved from Netlify to Vercel

- `netlify.toml` deleted, replaced by `vercel.json` (framework `nextjs`, build/install commands, region, and the same security headers — the header rules in `next.config.ts` still apply too).
- `@netlify/plugin-nextjs` removed from devDependencies; Vercel needs no adapter for Next.js.
- Docs and comments updated for Vercel's environment-variables UI.
- **Vercel Cron endpoints (optional):** the four scheduled jobs are also exposed as GET routes — `/api/cron/ingest`, `/api/cron/posts`, `/api/cron/sync`, `/api/cron/cleanup` (`src/app/api/cron/*`) — mirroring `scripts/*.ts`, guarded by a shared bearer-token check (`CRON_SECRET`, falling back to `REVALIDATE_SECRET`), and listed in `vercel.json` with the same schedules as the GitHub workflows. The workflows stay the default (free tier); if you enable Vercel Cron, disable the GitHub schedule triggers so jobs don't run twice.

The v1 app was a front-end prototype: RSS, AI and Buffer were simulated in the browser and every refresh reset the data. v2 replaces it with a working system. Every issue from the audit is addressed:

| # | v1 issue | v2 |
|---|---|---|
| 1 | Invented stories shown as real, credited to real publishers | Mock data deleted. Only real RSS items are stored, and every story links to its sources |
| 2 | Admin password in the JS bundle; "login" was a localStorage flag | scrypt-hashed password in env, signed httpOnly session cookie, server-side checks on every admin page and action, 5 failed attempts per 15 min per IP |
| 3 | Buffer token saved in localStorage | All keys live in env vars / GitHub secrets only |
| 4 | Posts over 280 characters; templates added made-up market claims | X's weighted character count, URLs counted as 23, automatic trimming; AI output validated (schema, no duplicates, hype filter, facts from headlines only) |
| 5 | Data lost on refresh; article links broke | Supabase PostgreSQL with stable story URLs |
| 6 | Refreshing an admin page sent you to the dashboard | Session is checked on the server before render; login returns you to the page you asked for |
| 7 | Retrying a run left it stuck on "running" | Runs are finalized on success and failure; runs that never finish are marked failed by the next ingest |
| 8 | Hard-coded price ticker | CoinGecko prices, cached 5 minutes |
| 9 | Hash URLs, client-only rendering, no per-page metadata | Server-rendered pages, clean URLs, per-page titles and descriptions, NewsArticle and Breadcrumb structured data, sitemap, Google News sitemap, RSS, OG images. Old `/#/…` links redirect |
| 10 | Wrong publisher links (decrypt.com, theblock.com) | Homepages defined explicitly per source |
| 11 | Category links didn't filter | Filters and search read from the URL; dedicated `/category/…` and `/source/…` pages |
| 12 | Local times labeled UTC | Every time is formatted in UTC and labeled |
| 13 | Timezone, AI model, importance and category settings did nothing | Settings are stored in Supabase PostgreSQL and used by the jobs; options that couldn't work were removed |
| 14 | Random numbers in the automation log | Real run history with per-feed results |

Also: removed the builder's sandbox scripts from `index.html`, 8 unused dependencies, Font Awesome and react-router (and its security advisories); added reduced-motion support, tests, CI, README and `.env.example`.

## v2.1

- **Fixed:** `npm run job:*` didn't read `.env.local`, so running the ingest locally failed before touching the database and only data written by the web app (posts) appeared. Scripts now load env files the same way `next dev` does.
- **Fixed:** the admin password hash contained `$`, which some `.env` loaders treat as a variable. The hash now uses `:` (old hashes still work).
- **New:** daily cleanup job and workflow; everything is kept for `RETENTION_DAYS` (default 30).
- **New:** search limited to that window, with a "When" filter (24 h, 7 days, 30 days) and coin-name matching; substring search replaces the text index.
- **New:** admin "Run now" runs jobs directly when no GitHub token is set (local development), plus a cleanup button and a stored-data panel.
- **New:** the "new stories" button also appears on the news list.
- Feeds that return 403 are retried once with a browser user agent; failed feeds are named in the run summary.
- Articles no longer store similarity tokens (only stories need them, and only for 48 hours).
- Verified end to end: three hourly runs (new, edited, merged, 304-unchanged), daily posts, and cleanup.

## v2.2

- **Free-tier speed:** public queries are cached (refreshed by the jobs through `/api/revalidate`), limited to 8 seconds, and fail softly with a self-retrying "Still connecting" notice instead of an error page. A slow database no longer turns real stories into 404s.
- Indexes are managed through Supabase SQL migrations; PostgreSQL uses a small serverless connection pool.
- Pages render per request on top of cached data, so a slow moment can't freeze an empty page in the static cache, and builds no longer need the database.
- Error pages show the real error in development and retry automatically; the admin and site keep their navigation when a page fails; loading skeletons while data arrives.
- A missing or short `SESSION_SECRET` no longer crashes admin pages; the login page says what to set.
- **Design:** site-wide tech backdrop (dot matrix and circuit grid with drifting glows); an animated peer-network hero on the home page where the five newsrooms send their coverage into one merged story; animated grid-floor headers on inner pages. All motion pauses off-screen and in background tabs, and stops for people who prefer reduced motion.

## v2.3

- **Posts sync with Buffer.** New `post-sync` job (every 3 hours, after the daily posts, and an admin button) writes each post's real outcome into `social_posts`: `sent` with the link on X, or `failed`. Posts written directly in Buffer for the same channel are imported. One API request per run; the Buffer organization id is looked up once and remembered.
- The daily posts job now says why when it creates nothing (no stories in the last 48 hours) instead of finishing silently.
- **Secrets:** every secret is read through `src/lib/env.ts`; `.env.example` no longer contains a credential-shaped placeholder (which Netlify's smart detection flags); `.gitignore` excludes every `.env*` file except the template; `npm run build` scans the repository before building and the build output afterwards, naming the file and variable if anything leaks; `netlify.toml` exempts non-secret settings from Netlify's scanner; `npm run check:env` lists what's set without printing values.

## v2.4

- **Buffer channel fix.** "Invalid ChannelId format" came from an unusable `BUFFER_CHANNEL_ID` value. The app now works out the channel itself: it accepts the id, the id with stray quotes or spaces, or the channel's name/@handle, and if the value is empty or wrong it uses the account's only X channel. The result is remembered in Supabase PostgreSQL (no extra API calls), and it's looked up again automatically if Buffer later rejects a remembered channel. When it can't decide, the error lists the channels on the account with their ids.
- New **Test Buffer connection** button in the admin dashboard: shows which channel posts will go to, and whether dry run is on. Sends nothing.
- All environment values are cleaned of surrounding quotes, spaces and invisible characters (common when pasting into Netlify or GitHub).
- The post queue and dashboard say clearly when dry run is on for the website, since it's configured separately from the GitHub jobs.

## v2.5

- **Where is my data?** The admin dashboard shows the Supabase PostgreSQL host and database name the site writes to (credentials removed), plus every table and its row count. Compare the host with Supabase → Project Settings → Database.
- New **Test database connection** button: runs a lightweight query against the configured Supabase database.
- Every GitHub job prints `Database: <name> on <cluster>` at the top of its log and in its run summary.

## v2.6

- **Breaking alerts.** After every hourly ingest, the most important new story (first reported in the last 3 hours, covered by 2+ newsrooms or with a high-impact headline, above the score for the chosen sensitivity) is posted immediately through Buffer (`shareNow`) instead of waiting for the next day's set. Configurable in Settings: on/off, sensitivity, max per day, minimum gap. Never the same story twice; approval mode and dry run are respected; each post records why it was sent.
- Approving a breaking alert later sends it immediately; daily posts keep their time slots.
- Posts linking to `localhost` are never sent; a clear error says to set SITE_URL.
- The hourly workflow now receives the AI and Buffer settings it needs for alerts.

## v2.7

- **Any number of posts per day (1–24).** Posts are spread evenly across a posting window (default 08:00–22:00 UTC), or use your exact times when you list at least as many as posts per day. The settings page shows today's schedule.
- **Rolling posting.** The posts job now runs every 2 hours and writes only the posts due in the next ~2.5 hours, from the freshest stories, instead of writing the whole day at 06:20. A slot missed by a late run is still posted within an hour; caught-up posts are spaced at least 15 minutes apart. Post types cycle breaking → market → insight. "Force" writes all remaining posts now.
- **Frugal post sync every 15 minutes:** only calls Buffer when a post is waiting to be confirmed, plus a full import every 3 hours.
- **Workflow fixes:** removed the duplicated `NEXT_PUBLIC_SITE_URL` and `REVALIDATE_SECRET` entries in `daily-posts.yml` (GitHub rejects duplicate keys); schedules now match: ingest at :17 every hour, posts every 2 hours, sync every 15 minutes. The posts workflow no longer repeats the ingest and sync steps (their own workflows cover them).
- `npm run check:workflows` (also run before every build and in CI) catches duplicate keys, malformed cron lines and misspelled secret/variable names in workflows.

## v2.8

- **X post styles:** with link (short hook + link), detailed (complete story, no link, credited to the newsroom) and humor (funny, facts intact, no link, never on serious stories). Mixed across the day by percentages in Settings; breaking alerts alternate link/detailed and are never jokes.
- **AI story summaries** for major stories: "the story so far", key facts, why it matters, shown on story pages and in lists. Refreshed when more newsrooms join; capped per run and per day.
- **Fact check on all AI text:** posts and summaries are rejected if they contain a number that isn't in the source material. Failed post slots are filled from headlines in the same position.
- Longer source excerpts (up to 600 characters) on story pages.
