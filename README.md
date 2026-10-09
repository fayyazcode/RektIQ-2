# RektoIQ

RektoIQ is a crypto intelligence platform combining news from five newsrooms, market data, and social sentiment. News is checked every hour, duplicate coverage is merged into single stories, and each day the three most important stories are written up by AI and scheduled on X through Buffer.

Production site: https://rektoiq.vercel.app

Everything runs on free tiers: **Next.js** (Vercel), **Supabase PostgreSQL**, **GitHub Actions** for the cron jobs, **Gemini** (with **Groq** as fallback) for writing, **Buffer** free plan for posting, **CoinGecko** for prices.

```
GitHub Actions ── every hour :07 ──▶  npm run job:ingest
                                        │ conditional GET ×5 feeds (304 = skip)
                                        │ normalize → exact de-dup → near-dup clustering
                                        ▼
                                Supabase PostgreSQL
                                articles · stories · outbound_posts · automation_runs · feed_state · settings
                                        ▲
GitHub Actions ── daily 02:40 UTC ──▶ npm run job:cleanup   (keeps the last 30 days)
                                        ▲                                  │
GitHub Actions ── daily 06:20 UTC ──▶ npm run job:posts                    │
                                        │ top 10 stories by score          │
                                        │ Gemini → Groq → rules            │
                                        ▼                                  ▼
                                     Buffer ──▶ X             Next.js site + admin (Vercel)
```

## How the hourly job handles redundancy

Every run compares what the feeds return with what's already stored, at four levels:

1. **Feed level.** Each feed's `ETag` / `Last-Modified` from the previous hour is sent back. A feed that hasn't changed answers `304` and is skipped without parsing.
2. **Batch level.** The same article listed twice in one fetch (two feeds, two categories) is kept once.
3. **Article level.** Every URL is canonicalized (https, no `www`, no `utm_*`/`fbclid`, no `/amp`, no trailing slash) and hashed. An article already stored is either **unchanged** (skipped) or **edited** (the publisher changed the headline or summary; it's updated in place and its `version` goes up).
4. **Story level.** New articles are compared with every story from the last 48 hours. If another newsroom already covered the same event, the article joins that story instead of creating a duplicate. Matching uses headline and body token overlap with number and ticker normalization (`$900M` = `900 million`), synonym folding (`surges` = `rallies`), and two safety checks: conflicting figures (`$120K` vs `$95K`) and conflicting players (Tether vs Circle, Binance vs Coinbase) count as different events. A second article from the *same* outlet only merges if it's nearly identical, because it's usually a follow-up.

Each run is saved in `automation_runs` with per-feed results and counts (new, edited, seen before, duplicates in batch, merged, new stories) plus the change versus the previous hour. The admin **Runs** page shows them.

## What's stored, and for how long

| Supabase table | What | Kept |
| --- | --- | --- |
| `stories` | One document per event, with its sources, topics, coins and importance score | 30 days after its last update |
| `articles` | Every publisher article (headline, summary, link, author, times, edit count), linked to its story | Deleted with its story |
| `outbound_posts` | X posts: text, type, status, schedule, Buffer id, which AI wrote it | 30 days |
| `automation_runs` | Every ingest, posting and cleanup run with its counts and errors | 30 days |
| `feed_state` | Per-feed ETag, last success, failures | While the feed is configured |
| `global_settings` | Admin settings | Always |
| `login_attempts` | Failed logins | 15 minutes (expired attempts are removed during writes) |

The **daily cleanup** (`daily-cleanup.yml`, 02:40 UTC) deletes stories older than the window together with their articles, old runs and posts, and strips the similarity data from stories that are past the 48-hour matching window. Change the window with `RETENTION_DAYS` (7 to 365).

**Search** (`/news`) covers the same window: every word must appear in the headline, summary or coin tags ("bitcoin" also finds stories tagged BTC), and it can be narrowed to the past 24 hours or 7 days, and by topic, source and coin.

**Normalization** applied to every item: HTML and entity stripping, Unicode (NFKC) and quote cleanup, publisher boilerplate removal ("The post … appeared first on …"), source suffixes removed from headlines, dates converted to UTC (future dates clamped, items older than 7 days rejected), feed tags mapped onto one fixed taxonomy of 16 topics, and coin tickers detected.

## Setup

```bash
npm install
cp .env.example .env.local        # then fill in the SECRETS section
npm run check:env                 # shows which variables are set (never their values)
npm run db:apply-migration        # apply the Supabase schema to a new project
npm run hash-password -- "choose-a-long-password"   # paste the output into .env.local
npm run job:ingest                                   # first fetch (reads .env.local)
npm run dev
```

Then open http://localhost:3000 and http://localhost:3000/admin. Locally, the admin **Run now** buttons run the jobs directly, so you can test everything without GitHub Actions.

**Nothing in `articles` or `stories`?** Open *Admin → Runs* (or the `automation_runs` table). Each ingest records every feed's result. `HTTP 403` means the feed blocked the request (the fetcher retries once as a browser); a network error usually means a firewall or proxy.

### Free accounts you need

| Service | What for | Where |
| --- | --- | --- |
| Supabase | PostgreSQL database and optional Auth | Create a project at supabase.com; use the transaction-pooler connection URL as `DATABASE_URL` |
| Google AI Studio | Gemini API key | aistudio.google.com |
| Groq (optional) | Fallback AI | console.groq.com |
| Buffer | Posting to X | Connect X in Buffer, then Settings → API. Get the channel id with the query below |
| CoinGecko (optional) | Demo key for higher price limits | coingecko.com/en/api |
| Vercel | Hosting | Import the repo; Vercel detects Next.js automatically and `vercel.json` is included |

`BUFFER_CHANNEL_ID` is optional: if it's empty or wrong and your Buffer account has exactly one X channel, that channel is used automatically (the admin dashboard's **Test Buffer connection** button shows which one, and its id). To look the id up yourself:

```bash
curl -s https://api.buffer.com -H "Authorization: Bearer $BUFFER_API_KEY" -H "Content-Type: application/json" \
  -d '{"query":"query { account { organizations { id } } }"}'
curl -s https://api.buffer.com -H "Authorization: Bearer $BUFFER_API_KEY" -H "Content-Type: application/json" \
  -d '{"query":"query { channels(input: { organizationId: \"ORG_ID\" }) { id name service } }"}'
```

### GitHub Actions (the cron jobs)

In the repo, **Settings → Secrets and variables → Actions**:

- **Secrets:** `DATABASE_URL`, `X_API_BEARER_TOKEN`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `BUFFER_API_KEY`, `REVALIDATE_SECRET`
- **Variables:** `SITE_URL` (your public URL, used in post links), `BUFFER_CHANNEL_ID`, optionally `BUFFER_ORG_ID`, `GEMINI_MODEL`, `GROQ_MODEL`, `BUFFER_DRY_RUN`, `RETENTION_DAYS`

The social-sentiment workflow requires `DATABASE_URL` (the Supabase pooled connection URL). Add it as an Actions secret; the workflow checks for it before installing dependencies. To collect and analyze X posts, also configure `X_API_BEARER_TOKEN` and at least one of `GEMINI_API_KEY` or `GROQ_API_KEY`.

Workflows:

- `hourly-ingest.yml`: every hour at :17. Right after each ingest it runs the **breaking alert** check (see below). Also re-enables the schedules, since GitHub pauses scheduled workflows after 60 days without repo activity.
- `daily-posts.yml`: every 2 hours at :05. Rolling: each run writes the posts whose time slot falls in the next ~2.5 hours, from the freshest top stories. Posts per day (1–24), the posting window and optional exact times are set in *Admin → Settings*. Runs with nothing due finish in seconds. *Run workflow* with *force* writes all of today's remaining posts at once.
- `daily-cleanup.yml`: 02:40 UTC. Deletes data older than the retention window.
- `post-sync.yml`: every 2 hours. Records what Buffer did with each post (sent with the link on X, or failed) and imports posts written directly in Buffer. It only calls Buffer's API when a post is waiting to be confirmed, plus a full import every 3 hours, so it stays inside the free plan's ~100 requests a day.
- `ci.yml`: typecheck, tests and build on every push and pull request.

**Vercel Cron:** not used on the free Hobby plan (cron triggers limited to once per day). All scheduled jobs run via **GitHub Actions** instead. The cron endpoints (`/api/cron/*`) are still available as HTTP routes if you trigger them manually or from an external scheduler like cron-job.org.

To use the admin **Run now** buttons, create a fine-grained personal access token with *Actions: read and write* on this repo only, and set `GITHUB_REPO` and `GITHUB_DISPATCH_TOKEN` on Vercel.

## Secrets

Every secret is read from the environment through one module, `src/lib/env.ts`. No file in the repository contains a real value.

| Where | How |
| --- | --- |
| Your computer | `.env.local` (or `.env`), copied from `.env.example`. Git ignores every `.env*` file except the empty template. |
| Vercel | Project → Settings → Environment Variables. Add the variables in the SECRETS section of `.env.example` as **Secret** type, the rest as **Variable**. |
| GitHub Actions | Settings → Secrets and variables → Actions, passed to the jobs by the workflow files. |

`npm run build` checks twice: before building it fails if a `.env` file is committed or a credential-shaped string (a connection string with a password, an API key, a token, a password hash) is in the code; after building it fails if the value of any secret variable ended up in `.next`. Both report the file and the variable name, never the value. Run `npm run check:secrets` any time.

Vercel doesn't need a scanner-omits list like `netlify.toml` used to: its environment variables live outside the repository, so the non-secret settings (site URL, database name, model names…) never get flagged as leaks. The repo-level checks above (`check:secrets`, run by `prebuild`/`postbuild`) still guard against real keys reaching git or the build output. If Vercel's deploy log ever reports a detected secret, treat it like a real leak: remove it and **rotate the key** (it's in git history).

If a `.env` file was ever pushed, run `git rm --cached .env .env.local`, commit, then rotate the Supabase database password and every API key it contained.

### Vercel environment

`DATABASE_URL`, `NEXT_PUBLIC_SITE_URL`, `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`, `SESSION_SECRET` (at least 32 characters), `REVALIDATE_SECRET`, `BUFFER_API_KEY`, `BUFFER_CHANNEL_ID` (for approve-and-send), `COINGECKO_DEMO_KEY`, `GITHUB_REPO`, `GITHUB_DISPATCH_TOKEN`. Configure Supabase Auth variables as described in `.env.example` if member sign-in is enabled.

Cron jobs run via **GitHub Actions**, not Vercel Cron (free tier limits cron triggers to once per day).

## X posts: three styles

Each post slot gets a style, spread across the day by the mix in *Admin → Settings* (default 50 / 30 / 20):

- **With link:** a short, specific hook plus a link to the story on this site.
- **Detailed (no link):** the complete story in the post: what happened, who, the key numbers, why it matters, credited to the newsroom ("per CoinDesk").
- **Humor (no link):** a light, funny take with the real facts inside. Never used on serious stories (hacks, scams, arrests, lawsuits, liquidations, losses); jokes aim at situations, never at people.

Every AI post is fact-checked before it's saved: any significant number that doesn't appear in the story material rejects the post (`$900M`, `$900 million` and `900m` count as the same number). A rejected slot is filled with a headline-based post instead; humor slots become detailed posts when no AI is available. Breaking alerts are never jokes.

## AI story summaries

Major stories (covered by 2+ newsrooms, high-impact or high-scoring) get an original summary on their page, written right after each hourly ingest from every newsroom's headline and excerpt: *the story so far*, *key facts* and *why it matters*. The same fact check applies: a fact with an invented number is dropped, and an invented number in the main text rejects the summary. Summaries are refreshed once more newsrooms join the story. Capped at 8 per run and `summariesPerDay` per day (default 40), to stay inside Gemini's free tier. Posts use these summaries too, so they're more specific.

## Breaking alerts (posted within the hour)

The daily set is written once a day and scheduled for fixed times. Important news doesn't wait: after every hourly ingest, the newest important story is posted immediately through Buffer.

A story qualifies when it was first reported in the last 3 hours, reaches the importance score for the chosen sensitivity, and is either covered by 2+ newsrooms or has a high-impact headline (hack, approval, lawsuit, record high…). Settings in *Admin → Settings*: on/off, sensitivity (strict / normal / relaxed), most alerts per day (default 3), minimum gap between alerts (default 90 minutes). A story is never posted twice, alerts respect approval mode and dry run, and the daily set skips stories that already went out as alerts. *Admin → Runs → Breaking alerts* shows every check and why it did or didn't post.

Alerts are only as punctual as the hourly job. GitHub's free scheduler often starts runs late or skips them, so for dependable timing trigger the workflow from an external scheduler such as cron-job.org (a POST to the workflow's `dispatches` API with your GitHub token, every hour).

## Running with Supabase PostgreSQL

The site and background jobs use the same Supabase PostgreSQL database through `DATABASE_URL`:

- **Cached reads.** Public news queries use Next's data cache (tag `news`). Jobs call `/api/revalidate` after writes, so new stories appear without waiting for the cache lifetime. Set `REVALIDATE_SECRET` on Vercel and as a GitHub secret.
- **Connection URL.** Use the Supabase transaction pooler URL for Vercel and GitHub Actions. Keep database credentials server-side; never use the browser anon key for direct SQL access.
- **Schema changes.** Database tables and indexes are defined in `supabase/migrations/` and applied with `npm run db:apply-migration` when setting up a new project.

For Supabase connection issues, verify the project is active, the URL is copied from **Project Settings → Database → Connection string → Transaction pooler**, and the database password is current.

## Model names

Free-tier model names change. If Gemini returns 404, check the current Flash model id in AI Studio and set `GEMINI_MODEL`. If every AI call fails, the job still posts headline-based text, and the run's notes explain why.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js |
| `npm run job:ingest` | One hourly ingest |
| `npm run job:posts -- --force` | Write today's posts even if they exist |
| `npm run job:cleanup` | Delete data older than the retention window |
| `npm run job:sync-posts` | Pull post status from Buffer into Supabase PostgreSQL |
| `npm run check:env` | Show which variables are set (names only) |
| `npm run check:secrets` | Scan the repository for committed secrets |
| `npm run db:apply-migration` | Apply the Supabase PostgreSQL schema migration |
| `npm run db:check-schema` | Verify required Supabase tables and indexes |
| `npm test` | Unit tests (normalization, clustering, hour-over-hour ingest, post length, AI output validation) |
| `npm run typecheck` | TypeScript |
| `npm run hash-password -- "…"` | Generate `ADMIN_PASSWORD_HASH` |

## What's real-time

- **News** changes once an hour, when the ingest runs. That's the limit of the approach: RSS feeds are pulled, not pushed.
- **"New stories" button:** the home page and the news list ask `/api/live` once a minute (only while the tab is visible) whether stories arrived since the page loaded, and offer to refresh.
- **Prices** in the ticker and sidebar are refreshed from CoinGecko at most every 5 minutes.
- **Market data** via Socket.IO: the persistent realtime worker polls CoinGecko every 60 seconds and broadcasts market updates, signals, and scores to connected browsers. GitHub Actions runs a bounded signal tick and a separate anomaly processor every 30 minutes; anomaly processing reads persisted snapshots and cannot hold up signals. See [Architecture](#architecture) and [DEPLOYMENT.md](./DEPLOYMENT.md).

## Architecture

RektoIQ uses a **three-tier architecture**:

- **Frontend** (Vercel/Netlify): Next.js app with SSR/SSG, served to browsers
- **Realtime/API Worker** (persistent Node.js): Socket.IO server, market data polling, signal/anomaly generation
- **Database** (Supabase PostgreSQL): application tables and indexes

```
┌─────────────────────────────────────────────────┐
│  FRONTEND (Vercel/Netlify)                       │
│  Next.js App │ Socket.IO Client │ Static Pages   │
└────────────────┬──────────────────┬───────────────┘
                 │                  │
┌────────────────┼──────────────────┼───────────────┐
│  API/WORKER    │                  │               │
│  Next.js API   │  Socket.IO       │  Background   │
│  Routes        │  Server          │  Jobs         │
│  /api/market/* │  :8790           │  ingest/posts │
│  /api/signals  │                  │  cleanup      │
│  /api/anomalies│                  │               │
│  /api/x/generate│                 │               │
└────────────────┼──────────────────┴───────────────┘
                 │
┌────────────────┼─────────────────────────────────┐
│  DATABASE      │                                  │
│  Supabase      │  assets, signals, anomalies,     │
│  PostgreSQL    │  news_impacts, ai_analyses,      │
│                │  market_snapshots, provider_health│
└────────────────┼─────────────────────────────────┘
                 │
┌────────────────┼─────────────────────────────────┐
│  EXTERNAL      │  CoinGecko, Gemini/Groq/Jev,    │
│  SERVICES      │  Buffer, RSS Feeds               │
└────────────────┴─────────────────────────────────┘
```

Full deployment guide: [DEPLOYMENT.md](./DEPLOYMENT.md)

## Project layout

```
src/app/(site)/        public pages: home, news (search + filters), story, source, category, posts, about
src/app/admin/         login + dashboard, runs, post queue, sources, settings (server actions)
src/app/               sitemap, news sitemap, robots, RSS, OG images, /api/live
src/lib/normalize/     URL, text, taxonomy, RSS item → normalized article
src/lib/dedupe/        similarity, story matching, importance score
src/lib/jobs/          ingest (DB), plan (pure logic), daily posts, cleanup
src/lib/ai/            prompt, Gemini/Groq providers, validation, rule-based fallback
src/lib/social/        X length counting, Buffer client
src/lib/auth/          scrypt passwords, signed session cookie, login rate limit
scripts/               CLI entry points used by GitHub Actions
tests/                 Vitest
```
