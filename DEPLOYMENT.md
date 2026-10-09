# RektoIQ — Deployment Guide

## Architecture Overview

RektoIQ uses a **three-tier architecture** to separate concerns and ensure scalability:

```
┌─────────────────────────────────────────────────────────────────┐
│  FRONTEND (Vercel)                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  Next.js App │  │  Static HTML │  │  Socket.IO   │          │
│  │  (SSR/SSG)   │  │  Pages       │  │  Client      │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         │                 │                 │                   │
│         └─────────────────┼─────────────────┘                   │
│                           │ WebSocket / HTTP                     │
└───────────────────────────┼─────────────────────────────────────┘
                            │
┌───────────────────────────┼─────────────────────────────────────┐
│  BACKGROUND JOBS         │                                      │
│  ┌───────────────────────┼──────────────────────────────────┐  │
│  │  GitHub Actions      │  (cron schedules)                 │  │
│  │  npm run job:ingest   │  (hourly)                         │  │
│  │  npm run job:posts    │  (every 2 hours)                  │  │
│  │  npm run job:cleanup  │  (daily)                          │  │
│  │  npm run job:sync     │  (every 2 hours)                  │  │
│  └───────────────────────┼──────────────────────────────────┘  │
└───────────────────────────┼─────────────────────────────────────┘
                            │
┌───────────────────────────┼─────────────────────────────────────┐
│  DATABASE (Supabase)      │                                      │
│  ┌───────────────────────┼──────────────────────────────────┐  │
│  │  PostgreSQL           │  (managed by Supabase)            │  │
│  │  tables:              │                                  │  │
│  │  - articles           │                                  │  │
│  │  - stories            │                                  │  │
│  │  - story_articles     │  (junction table)                 │  │
│  │  - assets             │                                  │  │
│  │  - market_snapshots   │                                  │  │
│  │  - signals            │                                  │  │
│  │  - anomalies          │                                  │  │
│  │  - news_entities      │                                  │  │
│  │  - news_impacts       │                                  │  │
│  │  - ai_analyses        │                                  │  │
│  │  - provider_health    │                                  │  │
│  │  - outbound_posts     │                                  │  │
│  │  - automation_runs    │                                  │  │
│  │  - feed_state         │                                  │  │
│  │  - global_settings    │                                  │  │
│  │  - login_attempts      │                                  │  │
│  │  (social sentiment tables)                                │  │
│  └───────────────────────┼──────────────────────────────────┘  │
└───────────────────────────┼─────────────────────────────────────┘
                            │
┌───────────────────────────┼─────────────────────────────────────┐
│  EXTERNAL SERVICES        │                                      │
│  ┌───────────────────────┼──────────────────────────────────┐  │
│  │  CoinGecko            │  Market data provider              │  │
│  │  Gemini / Groq / Jev  │  AI providers                      │  │
│  │  Buffer               │  X (Twitter) posting               │  │
│  │  RSS Feeds            │  News ingestion                      │  │
│  │  X (Twitter) API      │  Social sentiment collector         │  │
│  └───────────────────────┼──────────────────────────────────┘  │
└───────────────────────────┼─────────────────────────────────────┘
```

## Deployment Split

### Frontend (Vercel)
- **Next.js application** serving the web interface
- **Static generation** for most pages (SSG)
- **Server-side rendering** for dynamic pages (`/market`, `/signals`, `/anomalies`, etc.)
- **API routes** handled by the hosting platform
- **Socket.IO client** connects to the realtime worker

### Realtime/API Worker (Persistent Node.js Service)
- **Socket.IO server** for realtime market updates
- **Market data polling** from CoinGecko
- **Signal/anomaly generation** and persistence
- **Background jobs** for news correlation and data processing
- **Runs on**: Railway, Render, Fly.io, DigitalOcean, or any VPS

### Database (Supabase PostgreSQL)
- Supabase project with the schema from `supabase/migrations/`
- Use the transaction-pooler URL for the application and scheduled jobs
- Use the direct database URL only for schema migration commands when available

### Optional Cache/Queue
- **Redis** (optional, not required) — for distributed caching if multiple workers
- **In-process TTL cache** (current implementation) — sufficient for single-worker setup

## Environment Variables

### Secrets (never expose to browser)

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | Supabase PostgreSQL transaction-pooler URL | Yes |
| `DATABASE_MIGRATION_URL` | Optional direct Supabase PostgreSQL URL for migrations | No |
| `SESSION_SECRET` | 32+ random characters for session cookies | Yes |
| `ADMIN_PASSWORD_HASH` | Hashed admin password (run `npm run hash-password`) | Yes |
| `REVALIDATE_SECRET` | Secret for cache invalidation | Yes |
| `CRON_SECRET` | Secret for Vercel Cron endpoints | No |
| `GEMINI_API_KEY` | Google AI Studio API key | No |
| `GROQ_API_KEY` | Groq API key (fallback AI) | No |
| `BUFFER_API_KEY` | Buffer API key for X posting | No |
| `COINGECKO_DEMO_KEY` | CoinGecko demo key (higher rate limits) | No |
| `JEV_API_KEY` | Jev AI provider key | No |
| `GITHUB_DISPATCH_TOKEN` | GitHub PAT for admin Run Now buttons | No |
| `REALTIME_AUTH_SECRET` | Socket.IO authentication secret | No |

### Settings (safe to expose)

| Variable | Description | Default |
|----------|-------------|---------|
| `NEXT_PUBLIC_SITE_URL` | Public site URL | `https://rektoiq.vercel.app` |
| `NEXT_PUBLIC_SITE_NAME` | Site name | `RektoIQ` |
| `NEXT_PUBLIC_REALTIME_URL` | Socket.IO URL for browser | (mirrors `REALTIME_URL`) |
| `NEXT_PUBLIC_REALTIME_AUTH_TOKEN` | Socket.IO auth token for browser | (mirrors `REALTIME_AUTH_SECRET`) |
| `ADMIN_USERNAME` | Admin username | `admin` |
| `RETENTION_DAYS` | Days of data to keep | `30` |
| `GEMINI_MODEL` | Gemini model name | `gemini-2.5-flash` |
| `GROQ_MODEL` | Groq model name | `openai/gpt-oss-20b` |
| `MARKET_PROVIDER` | Market data provider | `coingecko` |
| `AI_PROVIDER_ORDER` | AI provider priority | `jev,gemini,groq` |
| `REALTIME_TICK_SECONDS` | Market data tick interval | `60` |
| `FEATURE_MARKET_INTEL` | Feature flag for market intel | `false` |
| `BUFFER_CHANNEL_ID` | Buffer X channel ID | (optional) |
| `BUFFER_ORG_ID` | Buffer organization ID | (optional) |
| `BUFFER_DRY_RUN` | Don't post to X, save only | `false` |
| `GITHUB_REPO` | GitHub repo for admin buttons | (optional) |

### RektoIQ branding and URLs

Add `rektoiq.vercel.app` to the Vercel project's domains, then set `NEXT_PUBLIC_SITE_URL` to `https://rektoiq.vercel.app` and `NEXT_PUBLIC_SITE_NAME` to `RektoIQ` in every deployment environment and redeploy. Set the GitHub Actions `SITE_URL` variable to the same URL so generated posts link to the production site. In Supabase Auth, set the Site URL and `/member/callback` redirect allowlist to this domain as well.

The GitHub repository rename requires repository-admin permission. Until that rename is completed, keep `GITHUB_REPO` pointed at the existing repository; update it to the new repository name afterward.

### Supabase Auth member setup

Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` for member authentication. Set `SUPABASE_SERVICE_ROLE_KEY` only as a server secret for the bootstrap-admin Access queue, which reads Auth email-confirmation status before approving a member. In the Supabase Auth dashboard, enable **Confirm Email**, set the Auth **Site URL** to the exact `NEXT_PUBLIC_SITE_URL`, and add exactly `<Site URL>/member/callback` to the redirect allowlist. Production signup confirmations and password-reset emails require configured and verified custom SMTP. Do not place a service-role key in browser variables or client code.

## Deployment Instructions

### Option A: Vercel (Frontend Only)

1. **Import the repo** on Vercel
2. **Set environment variables** in Vercel Project → Settings → Environment Variables
3. **Deploy** — Vercel detects Next.js automatically
4. **Realtime worker** — Deploy separately (see Option B)
5. **Cron jobs** — Handled by GitHub Actions (see `.github/workflows/`)

### Option B: Railway/Render (Persistent Worker)

1. **Create a new service** on Railway or Render
2. **Set environment variables**:
   ```
   DATABASE_URL=
   # Optional for applying migrations:
   DATABASE_MIGRATION_URL=
   # COINGECKO_DEMO_KEY=your-key
   REALTIME_URL=https://your-worker-url.com
   # REALTIME_AUTH_SECRET=your-optional-secret
   PORT=8790
   ```
3. **Deploy** from the `scripts/realtime-worker.ts` entry point
4. **The worker** starts on port 8790 and exposes Socket.IO

### Option C: Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
RUN npm run build
CMD ["npm", "run", "job:realtime"]
```

### Vercel Cron (Not available on free tier)

Vercel's free Hobby plan limits cron triggers to **once per day**, so Vercel Cron is **not used** for scheduled jobs. All cron jobs run via **GitHub Actions** instead. The `/api/cron/*` endpoints are still available as HTTP routes and can be triggered manually or from an external scheduler like cron-job.org.

If you upgrade to Vercel's Hobby plan or higher and want to use Vercel Cron instead of GitHub Actions:

1. **Add `CRON_SECRET`** to Vercel environment variables
2. **Set `GITHUB_REPO`** and `GITHUB_DISPATCH_TOKEN` for admin Run Now buttons
3. **Disable GitHub Actions workflows** to avoid double-running:
   ```bash
   gh workflow disable hourly-ingest.yml
   gh workflow disable daily-posts.yml
   gh workflow disable post-sync.yml
   gh workflow disable daily-cleanup.yml
   ```

## API Documentation

### Market Data

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/market/overview` | GET | Tracked market overview with scores |
| `/api/market/assets` | GET | All tracked assets |
| `/api/market/assets/:symbol` | GET | Asset detail with signals, anomalies, news |
| `/api/market/health` | GET | Provider health status |

### Signals

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/signals` | GET | List signals (paginated) |
| `/api/signals/:symbol` | GET | Signals for a specific symbol |

### Anomalies

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/anomalies` | GET | List anomalies (paginated) |

### News Impact

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/news/impact` | GET | News impact records |
| `/api/news/impact/:id` | GET | Single news impact |

### Degen Radar

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/degen` | GET | Small-cap high-turnover assets |
| `/api/degen?maxMarketCap=500000000` | GET | Custom market cap filter |

### X Post Generation

| Endpoint | Method | Description | Auth |
|----------|--------|-------------|------|
| `/api/x/generate` | POST | Generate X posts from evidence | Admin |

### Provider Health

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/provider-health` | GET | Provider health status |

### Live Updates

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/live?since=<timestamp>` | GET | Check for new stories since timestamp |

## Socket.IO Event Documentation

### Connection

```javascript
// Client connects with optional auth
const socket = io(SERVER_URL, {
  auth: { token: REALTIME_AUTH_SECRET }  // optional
});
```

### Events Sent by Server

| Event | Payload | Description |
|-------|---------|-------------|
| `market:update` | `MarketBatch` | New market data snapshot |
| `signal:new` | `Signal` | New signal event |
| `anomaly:new` | `Anomaly` | New anomaly detected |
| `asset:score` | `{ symbol, score, components, formulaVersion }` | Score update |
| `system:status` | `{ connected, serverTime, stale, tickMs }` | Server status |

### Events Received by Server

| Event | Payload | Description |
|-------|---------|-------------|
| `subscribe:asset` | `symbol: string` | Join asset room |
| `unsubscribe:asset` | `symbol: string` | Leave asset room |
| `join:memecoins` | — | Join memecoins topic room |

### Rooms

| Room | Description |
|------|-------------|
| `market:all` | All market updates |
| `asset:<SYMBOL>` | Specific asset updates |
| `topic:memecoins` | Memecoins (DOGE, SHIB, PEPE, etc.) |

### Connection Handling

- **Reconnect**: Automatic with Socket.IO client
- **Heartbeat**: `pingInterval: 10000ms`, `pingTimeout: 20000ms`
- **Auth**: Optional shared secret via `auth.token`
- **Stale data**: `system:status` includes `stale: true` when provider is rate-limited

## Provider Setup Instructions

### CoinGecko

1. Create a free account at [coingecko.com](https://www.coingecko.com/)
2. Get a demo API key from the dashboard
3. Set `COINGECKO_DEMO_KEY` in your environment
4. The provider tracks 10 coins by default (BTC, ETH, SOL, etc.)

### AI Providers

#### Gemini (primary)
1. Go to [aistudio.google.com](https://aistudio.google.com/)
2. Create a project and enable the Gemini API
3. Get an API key
4. Set `GEMINI_API_KEY`

#### Groq (fallback)
1. Go to [console.groq.com](https://console.groq.com/)
2. Create an account and get an API key
3. Set `GROQ_API_KEY`

#### Jev (optional)
1. Get a Jev API key from [jev.ai](https://jev.ai)
2. Set `JEV_API_KEY` and `JEV_MODEL`
3. Jev is prioritized first in `AI_PROVIDER_ORDER` if the key is set

### Social sentiment collection

The protected `/sentiment` workspace uses a GitHub Actions worker, not Vercel Cron. Add these GitHub Actions repository secrets:

- `DATABASE_URL`: the same pooled Supabase URL used by the site.
- `X_API_BEARER_TOKEN`: server-only X API bearer token. The selected X API plan must allow user lookup by username and user-timeline reads, including public engagement metrics.
- At least one of `GEMINI_API_KEY` or `GROQ_API_KEY` for validated sentiment classification. The worker uses `AI_PROVIDER_ORDER` (default `groq,gemini`) and their existing model variables.

The site’s status panel also checks whether X and AI credentials are present in its own server environment. Add `X_API_BEARER_TOKEN` and whichever AI key you use to Vercel Project → Settings → Environment Variables as **Secret** values as well; never use `NEXT_PUBLIC_` names for them.

The workflow runs every two hours. Each tracked profile request is bounded by `start_time` to the most recent two hours (or the last successful fetch with a one-minute overlap, capped at two hours); saved pagination cursors are deliberately ignored so old timelines are not backfilled. It reads at most one 100-post timeline page per profile, stores posts, expanded links, media descriptions, and referenced-post metadata, and analyzes up to 30 pending posts per run. Replies are collected (retweets remain excluded). Sentiment analysis and consensus use stored post publication times over rolling two-hour and seven-day windows; a post is classified once and reused in later aggregations. A signal requires at least two distinct tracked accounts to agree, with at least two-thirds of participating accounts aligned. Listed assets additionally require fresh market snapshots covering at least 90 minutes with price direction matching the social consensus. When a new token has no supported market listing, an evidence-checked name, ticker, hashtag, contract, URL, image description, or explicit thread/reference can identify it; strong multi-account consensus produces a clearly labeled social-discovery signal without claiming market confirmation. Ambiguous text or same-author timing alone is not enough to identify a token. Signals are upserted by the consensus event rather than recreated on each scheduled run. Supported-market signals receive 4-hour, 24-hour, and 7-day price-outcome records; social-only discoveries are marked not evaluable until market price data exists.

Independently, the worker classifies at most 20 uncached crypto-news articles from the previous 24 hours per run, so news sentiment remains available when the X token is absent or X signals go stale. The workspace keeps X signals distinct: readings without a supporting post in the last two hours are labeled stale, while recent news tone is labeled as a fallback and only shown for assets without a fresh X signal. News fallback is based on actual article headlines/summaries and is not presented as social sentiment. X post text is erased after 20 days; social metadata, analyses, fallback analyses, and signals are removed after `RETENTION_DAYS` (default 30) by the daily cleanup job.

After adding the secrets, use **Actions → Social sentiment collector → Run workflow** to test the pipeline. The member workspace reports the last collection run, active-profile errors, recent aggregate sentiment, and source-post evidence. If no signals appear, check the Actions run summary and Vercel environment for the same database project.

### Buffer (X Posting)

1. Create a Buffer account at [buffer.com](https://buffer.com/)
2. Connect your X account
3. Get your API key from Buffer Settings → API
4. Get your channel ID:
   ```bash
   curl -s https://api.buffer.com -H "Authorization: Bearer $BUFFER_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"query":"query { channels(input: { organizationId: \"ORG_ID\" }) { id name service } }"}'
   ```
5. Set `BUFFER_API_KEY` and `BUFFER_CHANNEL_ID`

### Supabase PostgreSQL

1. Create a project at [supabase.com](https://supabase.com/)
2. Open **Project Settings → Database → Connection string**
3. Copy the **Transaction pooler** URL into `DATABASE_URL` for Vercel and GitHub Actions
4. If applying schema migrations from a local machine, copy the direct connection URL into `DATABASE_MIGRATION_URL`
5. Apply the schema with `npm run db:apply-migration`; verify it with `npm run db:check-schema`
6. For an existing project, apply the dashboard-index migration with `npm run db:apply-migration -- supabase/migrations/20261007173000_admin_dashboard_indexes.sql --force`

## Troubleshooting

### Common Issues

**"No market data yet"**
- Ensure `COINGECKO_DEMO_KEY` is set (or the provider is configured)
- Check that the realtime worker is running
- Verify `DATABASE_URL` is set to the Supabase transaction-pooler URL
- The market data tick runs every 60 seconds

**Socket.IO not connecting**
- Verify `NEXT_PUBLIC_REALTIME_URL` is set to the worker URL
- Check that the worker is running on the correct port (default: 8790)
- If `REALTIME_AUTH_SECRET` is set, ensure `NEXT_PUBLIC_REALTIME_AUTH_TOKEN` matches
- Check browser console for WebSocket errors

**AI explanations not appearing**
- Ensure at least one AI provider key is set (`GEMINI_API_KEY`, `GROQ_API_KEY`, or `JEV_API_KEY`)
- The AI explanation is cached by evidence hash — if the evidence hasn't changed, cached results are used
- Check the `app.ai_analyses` table for stored analyses

**News impact records not appearing**
- Ensure articles have `coins` tags (normalized during RSS ingest)
- Market snapshots must exist before publication (at least 3 data points)
- The correlation runs as part of `npm run job:ingest`

**Rate limited by CoinGecko**
- The provider enters a backoff period (up to 5 minutes)
- Stale cache data is served during backoff with `stale: true`
- Set `COINGECKO_DEMO_KEY` for higher rate limits
- The tick interval can be adjusted with `REALTIME_TICK_SECONDS`

**Deployment issues**
- `npm run build` fails with secret detection: Check `npm run check:secrets`
- `npm run typecheck` fails: Run `npx tsc --noEmit` to identify issues
- Tests fail: Run `npm test` to see which tests fail

### Debugging

**Check provider health**
```bash
curl http://localhost:8790/healthz
```

**Check environment variables**
```bash
npm run check:env    # Shows which variables are set (names only)
npm run check:secrets # Scans for committed secrets
```

**Run the realtime worker locally**
```bash
npm run job:realtime
# Worker starts on port 8790
```

**Run one bounded market tick manually**
```bash
REALTIME_ONCE=true npm run job:realtime  # Runs one tick, then exits
npm run job:anomalies                    # Analyze saved snapshots separately
```

## Security Audit Summary

- **Environment variables**: Secrets never exposed to browser; read only through `src/lib/env.ts`
- **Admin routes**: Protected by session cookie and password hash
- **X publishing**: Only authenticated/admin users can publish; generation is separated from publishing
- **API inputs**: All inputs validated with Zod schemas
- **Socket.IO payloads**: No secrets in payloads; server-side validation; auth optional
- **PostgreSQL queries**: Parameterized through Drizzle; no injection vectors
- **HTML/news rendering**: Sanitized through Next.js escaping
- **Authentication**: scrypt passwords, signed session cookies, login rate limiting
- **Rate limits**: Login attempts have TTL; API routes have no hard rate limits (free tier friendly)

## Feature Flags

The `FEATURE_MARKET_INTEL` flag controls whether the market intelligence features are enabled. When `false`, market data endpoints return empty results. This allows gradual rollout.

```bash
FEATURE_MARKET_INTEL=true   # Enable market intelligence
FEATURE_MARKET_INTEL=false  # Disable (default)
```

## Rolling Out in Order

1. **Market data backend** → Deploy realtime worker with CoinGecko
2. **Market API** → Verify `/api/market/*` endpoints
3. **Deterministic scores** → Verify score computation
4. **Socket.IO** → Verify WebSocket connections
5. **Live Market UI** → Add MarketPulse component
6. **Signal Feed** → Add SignalFeed component
7. **Anomalies** → Add AnomalyFeed component
8. **News Impact** → Add NewsImpact component and correlation wiring
9. **AI** → Verify AI provider with Jev adapter
10. **Degen Radar** → Add DegenRadar component
11. **X generation** → Verify `/api/x/generate`
12. **On-chain phase** → Future work

## Build and Test

```bash
# Install dependencies
npm install

# Type check
npm run typecheck

# Run tests
npm test

# Build for production
npm run build

# Run lint
npm run lint  # if available

# Check secrets
npm run check:secrets

# Check environment
npm run check:env

# Setup database indexes
npm run db:apply-migration
```
