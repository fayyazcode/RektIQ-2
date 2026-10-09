/**
 * Realtime market worker (Phases 1, 3–6, 9, 13, 15). A persistent Node.js
 * process with Socket.IO — Vercel serverless can't host websockets, so this
 * runs on any always-on host (Railway/Render/Fly/small VPS) beside the existing
 * PostgreSQL. The Next.js site stays on Vercel and reads the same database plus
 * /api/market/* routes.
 *
 * Pipeline per tick:
 *   provider → normalize → score/signals → PostgreSQL + Socket.IO
 * Anomalies are generated separately from persisted snapshots.
 * Browsers never poll CoinGecko; one shared feed feeds everyone.
 *
 * Run: npm run job:realtime   (persistent; needs DATABASE_URL)
 * One-shot Actions run: set REALTIME_ONCE=true to process one tick and exit.
 */
import "../scripts/_env"; // loads .env the same way `next dev` does — must be first
import http from "node:http";
import { Server } from "socket.io";
import { closePostgresDb, getPostgresDb } from "../src/lib/db/client";
import { SITE } from "../src/lib/config";
import { config, secret as readSecret } from "../src/lib/env";
import { getSettings } from "../src/lib/settings";
import { getMarketBatch, marketHealth, resetMarketService } from "../src/lib/market/service";
import type { AssetSnapshot } from "../src/lib/market/types";
import { computeScore, scoreInputFromSnapshot } from "../src/lib/score/engine";
import { EARLY_SIGNAL_THRESHOLDS, evaluateSignal, signalDedupeKey, type SignalType } from "../src/lib/signals/engine";
import { evaluateSignalOutcomeStage, type OutcomeSnapshot } from "../src/lib/signals/outcomes";
import { parseStoredAssetSnapshot } from "../src/lib/anomalies/engine";
import * as schema from "../src/lib/db/schema";
import { and, asc, desc, eq, gt, gte, inArray, lt, lte, notExists } from "drizzle-orm";


const TICK_MS = Math.max(30_000, Number(config("REALTIME_TICK_SECONDS")) * 1000 || 60_000);
const PORT = Number(process.env.PORT) || 8790;
const BASELINE_WINDOW_HOURS = 24;
const MEMECOINS = new Set(["DOGE", "SHIB", "PEPE", "WIF", "BONK", "FLOKI", "CAT", "MOG", "BRETT"]);
const LEGACY_SNAPSHOT_FRESHNESS_MS = 5 * 60_000;

/* ── HTTP + Socket.IO ─────────────────────────────────────── */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, lastTickAt: lastTickAt?.toISOString() ?? null, stale: lastBatchStale, tickMs: TICK_MS }));
    return;
  }
  res.writeHead(404).end();
});

const io = new Server(server, {
  cors: { origin: SITE.url, credentials: false },
  pingInterval: 10_000,
  pingTimeout: 20_000,
  maxHttpBufferSize: 1e6,
});

const SYMBOL_RE = /^[A-Z0-9$\-\.]{1,20}$/;

io.use((socket, next) => {
  // Optional shared secret so only our frontends connect. Never put secrets in payloads.
  const expected = readSecret("REALTIME_AUTH_SECRET");
  if (expected) {
    const token = socket.handshake.auth?.token;
    if (token !== expected) return next(new Error("unauthorized"));
  }
  next();
});

io.on("connection", (socket) => {
  socket.join("market:all");
  socket.emit("system:status", { connected: true, serverTime: new Date().toISOString(), stale: lastBatchStale, tickMs: TICK_MS });
  if (lastBatch) socket.emit("market:update", lastBatch);

  socket.on("subscribe:asset", (symbol: unknown, ack?: (r: unknown) => void) => {
    if (typeof symbol !== "string" || !SYMBOL_RE.test(symbol.toUpperCase())) {
      ack?.({ ok: false, error: "invalid symbol" });
      return;
    }
    socket.join(`asset:${symbol.toUpperCase()}`);
    ack?.({ ok: true });
  });
  socket.on("unsubscribe:asset", (symbol: unknown) => {
    if (typeof symbol === "string" && SYMBOL_RE.test(symbol.toUpperCase())) socket.leave(`asset:${symbol.toUpperCase()}`);
  });
  socket.on("join:memecoins", () => socket.join("topic:memecoins"));
});

/* ── State ────────────────────────────────────────────────── */

let lastTickAt: Date | null = null;
let lastBatchStale = true;
let lastBatch: { assets: AssetSnapshot[]; fetchedAt: string; provider: string; stale: boolean; error?: string } | null = null;
let running = false;

async function newsCounts(symbols: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    const db = getPostgresDb();
    const since = new Date(Date.now() - 24 * 3600_000);
    const symbolSet = new Set(symbols);
    const rows = await db
      .select({ _id: schema.articles.id, symbol: schema.articles.coins })
      .from(schema.articles)
      .where(gte(schema.articles.publishedAt, since));

    // Flatten and count coins per symbol
    const coinCounts = new Map<string, number>();
    for (const row of rows) {
      const coins = Array.isArray(row.coins) ? row.coins : [];
      for (const coin of coins) {
        const upper = coin.toUpperCase();
        if (symbolSet.has(upper)) coinCounts.set(upper, (coinCounts.get(upper) ?? 0) + 1);
      }
    }
    return coinCounts;
  } catch (err) {
    console.warn("[worker] news counts failed:", err instanceof Error ? err.message : err);
    return out;
  }
}

async function persist(batch: NonNullable<typeof lastBatch>, ingestedAt: Date) {
  const db = getPostgresDb();
  try {
    await db.insert(schema.marketSnapshots).values(
      batch.assets.map((asset) => ({
        symbol: asset.symbol,
        sampledAt: new Date(asset.timestamp),
        ingestedAt,
        snapshot: asset,
        batchStale: batch.stale,
      }))
    );
  } catch (err) {
    console.warn("[worker] snapshot insert failed:", err instanceof Error ? err.message : err);
  }
  const h = marketHealth();
  try {
    await db
      .update(schema.providerHealth)
      .set({
        requests: h.requests,
        errors: h.errors,
        rateLimits: h.rateLimits,
        avgLatencyMs: h.avgLatencyMs,
        stale: h.stale,
        lastError: h.lastError,
        updatedAt: ingestedAt,
        ...(h.lastSuccessAt ? { lastSuccessAt: new Date(h.lastSuccessAt) } : {}),
        ...(h.lastFailureAt ? { lastFailureAt: new Date(h.lastFailureAt) } : {}),
      })
      .where(eq(schema.providerHealth.providerId, h.provider));
  } catch (err) {
    console.warn("[worker] provider health update failed:", err instanceof Error ? err.message : err);
  }
}

type PersistedSnapshot = Pick<typeof schema.marketSnapshots.$inferSelect, "symbol" | "ingestedAt" | "snapshot" | "batchStale">;

function snapshotIsStale(snapshot: Pick<PersistedSnapshot, "ingestedAt" | "snapshot" | "batchStale">): boolean {
  if (snapshot.batchStale === true) return true;
  const providerTimestamp = snapshot.snapshot.timestamp;
  const providerTime = typeof providerTimestamp === "string" ? Date.parse(providerTimestamp) : NaN;
  return !Number.isFinite(providerTime) || Math.abs(providerTime - snapshot.ingestedAt.getTime()) > LEGACY_SNAPSHOT_FRESHNESS_MS;
}

function outcomeSnapshot(snapshot: PersistedSnapshot): OutcomeSnapshot {
  const asset = parseStoredAssetSnapshot(snapshot.symbol, snapshot.snapshot);
  return {
    timestamp: snapshot.ingestedAt,
    price: asset?.price ?? NaN,
    volume24h: asset?.volume24h ?? null,
    volumeQuality: asset?.volumeQuality === "outlier" ? "outlier" : undefined,
    stale: snapshotIsStale(snapshot),
  };
}

function signalTimeSnapshot(snapshots: PersistedSnapshot[], signalTime: Date): (PersistedSnapshot & { asset: AssetSnapshot }) | null {
  const signalTimeMs = signalTime.getTime();
  const candidates = snapshots.flatMap((snapshot) => {
    const timestamp = snapshot.ingestedAt.getTime();
    const asset = parseStoredAssetSnapshot(snapshot.symbol, snapshot.snapshot);
    return asset && !snapshotIsStale(snapshot) && Number.isFinite(timestamp) && timestamp <= signalTimeMs &&
      signalTimeMs - timestamp <= LEGACY_SNAPSHOT_FRESHNESS_MS && asset.price > 0
      ? [{ ...snapshot, asset }]
      : [];
  });
  return candidates.length ? candidates[candidates.length - 1] : null;
}

async function evaluateOutcomeStage(signalId: string, horizonMinutes: 60 | 240, now: Date): Promise<void> {
  try {
    const db = getPostgresDb();
    const signal = await db
      .select()
      .from(schema.marketSignals)
      .where(eq(schema.marketSignals.id, signalId))
      .limit(1);

    if (!signal.length) return;

    const signalObj = signal[0];
    const signalTime = signalObj.occurredAt;
    const deadline = new Date(signalTime.getTime() + horizonMinutes * 60_000);
    const preSignalStart = new Date(signalTime.getTime() - 60 * 60_000);
    const [assetSnapshots, btcSnapshots] = await Promise.all([
      db
        .select()
        .from(schema.marketSnapshots)
        .where(and(
          eq(schema.marketSnapshots.symbol, signalObj.symbol),
          gte(schema.marketSnapshots.ingestedAt, preSignalStart),
          lte(schema.marketSnapshots.ingestedAt, deadline)
        ))
        .orderBy(asc(schema.marketSnapshots.ingestedAt)),
      signalObj.symbol === "BTC"
        ? Promise.resolve([] as typeof schema.marketSnapshots.$inferSelect[])
        : db
          .select()
          .from(schema.marketSnapshots)
          .where(and(
            eq(schema.marketSnapshots.symbol, "BTC"),
            gte(schema.marketSnapshots.ingestedAt, preSignalStart),
            lte(schema.marketSnapshots.ingestedAt, deadline)
          ))
          .orderBy(asc(schema.marketSnapshots.ingestedAt))
    ]);

    const signalSnapshot = signalTimeSnapshot(assetSnapshots, signalTime);
    const stage = evaluateSignalOutcomeStage({
      asset: {
        marketCap: signalSnapshot?.asset.marketCap ?? null,
        volume24h: signalSnapshot?.asset.volume24h ?? null,
        volumeQuality: signalSnapshot?.asset.volumeQuality,
        stale: signalSnapshot ? snapshotIsStale(signalSnapshot) : true,
      },
      signalPrice: signalSnapshot?.asset.price ?? null,
      signalTime,
      assetSnapshots: assetSnapshots.map(outcomeSnapshot),
      direction: signalObj.type === "bearish" ? "bearish" : "bullish",
      horizonMinutes,
      btcSnapshots: (signalObj.symbol === "BTC" ? assetSnapshots : btcSnapshots).map(outcomeSnapshot),
      evaluationTime: now,
    });
    await db
      .insert(schema.marketSignalOutcomes)
      .values({ signalId, ...stage, updatedAt: now })
      .onConflictDoNothing();
  } catch (err) {
    console.error(`[worker] ${signalId} ${horizonMinutes}m outcome evaluation failed:`, err instanceof Error ? err.message : err);
  }
}

export async function evaluateDueSignalOutcomes(now: Date): Promise<void> {
  try {
    const db = getPostgresDb();
    const oneHourDueAt = new Date(now.getTime() - 60 * 60_000);
    const fourHourDueAt = new Date(now.getTime() - 240 * 60_000);
    async function unevaluatedSignals(horizonMinutes: 60 | 240, dueAt: Date) {
      return db
        .select({ id: schema.marketSignals.id })
        .from(schema.marketSignals)
        .where(and(
          inArray(schema.marketSignals.type, ["bullish", "bearish"]),
          lte(schema.marketSignals.occurredAt, dueAt),
          notExists(
            db.select({ id: schema.marketSignalOutcomes.id })
              .from(schema.marketSignalOutcomes)
              .where(and(
                eq(schema.marketSignalOutcomes.signalId, schema.marketSignals.id),
                eq(schema.marketSignalOutcomes.horizonMinutes, horizonMinutes),
              ))
          ),
        ));
    }
    const [oneHourSignals, fourHourSignals] = await Promise.all([
      unevaluatedSignals(60, oneHourDueAt),
      unevaluatedSignals(240, fourHourDueAt),
    ]);

    const attempts = [
      ...oneHourSignals.map((signal) => ({ signalId: signal.id, horizonMinutes: 60 as const })),
      ...fourHourSignals.map((signal) => ({ signalId: signal.id, horizonMinutes: 240 as const })),
    ];

    for (const { signalId, horizonMinutes } of attempts) {
      try {
        await evaluateOutcomeStage(signalId, horizonMinutes, now);
      } catch (err) {
        console.error(`[worker] ${signalId} ${horizonMinutes}m outcome evaluation failed:`, err instanceof Error ? err.message : err);
      }
    }
  } catch (err) {
    console.error("[worker] due outcome evaluation failed:", err instanceof Error ? err.message : err);
  }
}

type AssetContext = {
  newsCount: number;
  baselineVolume: number | null;
  prevTypes: SignalType[];
  prevScore: number | null;
  prevEmittedAt: Date | null;
  momentum: { priceChange15m: number; priceChange1h: number } | null;
};

function percentChange(current: number, earlier: number): number | null {
  return Number.isFinite(current) && Number.isFinite(earlier) && earlier > 0
    ? ((current - earlier) / earlier) * 100
    : null;
}

function momentumFromSnapshots(
  snapshots: PersistedSnapshot[],
  now: Date,
  currentPrice: number,
  batchStale: boolean,
): AssetContext["momentum"] {
  const nowMs = now.getTime();
  if (batchStale) return null;

  const valid = snapshots
    .flatMap((snapshot) => {
      const asset = parseStoredAssetSnapshot(snapshot.symbol, snapshot.snapshot);
      return asset && !snapshotIsStale(snapshot) && asset.price > 0
        ? [{ ingestedAt: snapshot.ingestedAt, price: asset.price }]
        : [];
    })
    .sort((left, right) => left.ingestedAt.getTime() - right.ingestedAt.getTime());
  const referenceAt = (minutesAgo: number, toleranceMinutes: number) => {
    const target = nowMs - minutesAgo * 60_000;
    const reference = [...valid].reverse().find((snapshot) => snapshot.ingestedAt.getTime() <= target);
    if (!reference || target - reference.ingestedAt.getTime() > toleranceMinutes * 60_000) return null;
    return reference.price;
  };
  const price15m = referenceAt(15, 5);
  const price1h = referenceAt(60, 10);
  if (price15m === null || price1h === null) return null;
  const priceChange15m = percentChange(currentPrice, price15m);
  const priceChange1h = percentChange(currentPrice, price1h);
  return priceChange15m === null || priceChange1h === null ? null : { priceChange15m, priceChange1h };
}

async function loadAssetContext(a: AssetSnapshot, news: Map<string, number>, batchStale: boolean, ingestedAt: Date): Promise<AssetContext> {
  try {
    const db = getPostgresDb();
    const newsCount = news.get(a.symbol) ?? 0;
    let baselineVolume: number | null = null;
    let prevTypes: SignalType[] = [];
    let prevScore: number | null = null;
    let prevEmittedAt: Date | null = null;
    let momentum: AssetContext["momentum"] = null;

    const snaps = await db
      .select()
      .from(schema.marketSnapshots)
      .where(and(
        eq(schema.marketSnapshots.symbol, a.symbol),
        gte(schema.marketSnapshots.ingestedAt, new Date(ingestedAt.getTime() - BASELINE_WINDOW_HOURS * 3600_000)),
        lt(schema.marketSnapshots.ingestedAt, ingestedAt),
      ))
      .orderBy(asc(schema.marketSnapshots.ingestedAt))
      .limit(200);

    const freshSnaps = snaps.flatMap((snapshot) => {
      const asset = parseStoredAssetSnapshot(snapshot.symbol, snapshot.snapshot);
      return asset && !snapshotIsStale(snapshot) ? [asset] : [];
    });
    if (freshSnaps.length) {
      baselineVolume = freshSnaps.reduce((sum, snapshot) => sum + snapshot.volume24h, 0) / freshSnaps.length;
    }

    const lookbackSnaps = await db
      .select()
      .from(schema.marketSnapshots)
      .where(and(
        eq(schema.marketSnapshots.symbol, a.symbol),
        gte(schema.marketSnapshots.ingestedAt, new Date(ingestedAt.getTime() - 70 * 3600_000)),
        lt(schema.marketSnapshots.ingestedAt, ingestedAt),
      ))
      .orderBy(asc(schema.marketSnapshots.ingestedAt))
      .limit(100);

    momentum = momentumFromSnapshots(lookbackSnaps, ingestedAt, a.price, batchStale);

    const state = await db
      .select({ score: schema.assets.score, scoreComponents: schema.assets.scoreComponents })
      .from(schema.assets)
      .where(eq(schema.assets.symbol, a.symbol))
      .limit(1);

    prevScore = state.length ? state[0].score : null;

    const activeSignals = await db
      .select({
        type: schema.marketSignals.type,
        score: schema.marketSignals.score,
        occurredAt: schema.marketSignals.occurredAt,
      })
      .from(schema.marketSignals)
      .where(and(
        eq(schema.marketSignals.symbol, a.symbol),
        gt(schema.marketSignals.expiresAt, ingestedAt),
      ))
      .orderBy(desc(schema.marketSignals.occurredAt));

    prevTypes = activeSignals.map(s => s.type as SignalType);
    const latest = activeSignals[0];
    prevScore = latest?.score ?? prevScore;
    prevEmittedAt = latest ? latest.occurredAt : null;

    return { newsCount, baselineVolume, prevTypes, prevScore, prevEmittedAt, momentum };
  } catch (err) {
    console.error("[worker] loadAssetContext failed:", err instanceof Error ? err.message : err);
    return { newsCount: 0, baselineVolume: null, prevTypes: [], prevScore: null, prevEmittedAt: null, momentum: null };
  }
}

async function processAssetSignal(a: AssetSnapshot, context: AssetContext) {
  const { newsCount, baselineVolume, prevTypes, prevScore, prevEmittedAt, momentum } = context;

  // ── Score (deterministic, versioned) ────────────────────────
  const result = computeScore(scoreInputFromSnapshot(a, { avgVolumePrior: baselineVolume, newsCount24h: newsCount, socialScore: null }));

  try {
    const db = getPostgresDb();
    await db
      .update(schema.assets)
      .set({
        name: a.name,
        latestSnapshot: a,
        baselineVolume,
        score: result.score,
        scoreComponents: result.components,
        formulaVersion: result.formulaVersion,
        scoredAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.assets.symbol, a.symbol));
  } catch (err) {
    console.error("[worker] asset update failed:", err instanceof Error ? err.message : err);
  }

  try {
    const db = getPostgresDb();
    io.to("market:all").emit("asset:score", { symbol: a.symbol, score: result.score, components: result.components, formulaVersion: result.formulaVersion, timestamp: new Date().toISOString() });
    io.to(`asset:${a.symbol}`).emit("asset:score", { symbol: a.symbol, score: result.score, components: result.components, formulaVersion: result.formulaVersion, timestamp: new Date().toISOString() });
    if (MEMECOINS.has(a.symbol)) io.to("topic:memecoins").emit("asset:score", { symbol: a.symbol, score: result.score, formulaVersion: result.formulaVersion, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error("[worker] socket emit failed:", err instanceof Error ? err.message : err);
  }

  // ── Signals (threshold crossing + duplicate suppression) ────
  const volumeRatio = baselineVolume && baselineVolume > 0 ? a.volume24h / baselineVolume : null;
  const largeLiquid = a.marketCap >= EARLY_SIGNAL_THRESHOLDS.largeLiquidMarketCapUsd &&
    a.volume24h >= EARLY_SIGNAL_THRESHOLDS.largeLiquidVolume24hUsd && a.volumeQuality !== "outlier";
  const triggerThreshold = largeLiquid ? EARLY_SIGNAL_THRESHOLDS.largeLiquid : EARLY_SIGNAL_THRESHOLDS.other;
  const signalEvidence = {
    price: a.price,
    priceChange24h: a.priceChange24h,
    volume24h: a.volume24h,
    marketCap: a.marketCap,
    score: result.score,
    components: result.components,
    volumeRatio,
    newsCount24h: newsCount,
    priceChange15m: momentum?.priceChange15m ?? null,
    priceChange1h: momentum?.priceChange1h ?? null,
    triggerModel: "momentum_acceleration_v1" as const,
    triggerThreshold15mPct: triggerThreshold.priceChange15mPct,
    triggerThreshold1hPct: triggerThreshold.priceChange1hPct,
    triggerMinVolumeRatio: triggerThreshold.minVolumeRatio,
  };

  try {
    const candidates = evaluateSignal({
      symbol: a.symbol,
      now: new Date(),
      result,
      evidence: signalEvidence,
      volumeRatio,
      momentum,
      previous: prevScore !== null && prevEmittedAt ? { score: prevScore, types: prevTypes, emittedAt: prevEmittedAt } : prevEmittedAt ? { score: prevScore ?? result.score, types: prevTypes, emittedAt: prevEmittedAt } : null,
    });

    for (const cand of candidates) {
      const key = signalDedupeKey(cand.symbol, cand.type, new Date(cand.timestamp));
      try {
        const db = getPostgresDb();
        const result = await db
          .insert(schema.marketSignals)
          .values({
            dedupeKey: key,
            symbol: cand.symbol,
            type: cand.type,
            score: cand.score,
            evidence: cand.evidence,
            occurredAt: new Date(cand.timestamp),
            expiresAt: new Date(cand.expiresAt),
            formulaVersion: cand.formulaVersion,
            createdAt: new Date(),
          })
          .onConflictDoNothing()
          .returning({ id: schema.marketSignals.id });

        if (result.length) {
          (cand as { id?: string }).id = result[0].id;
          const payload = { ...cand };
          io.to("market:all").emit("signal:new", payload);
          io.to(`asset:${cand.symbol}`).emit("signal:new", payload);
          console.log(`[worker] signal ${cand.symbol} ${cand.type} score=${cand.score}`);
        }
      } catch (err) {
        if ((err as { code?: number }).code === 23505) continue; // duplicate key violation
        throw err;
      }
    }
  } catch (err) {
    console.error("[worker] signal processing failed:", err instanceof Error ? err.message : err);
  }
}

async function tick() {
  if (running) return;
  running = true;
  try {
    // Watchlist comes from the shared settings doc (admin → Market CRUD), so a
    // symbol added in the dashboard is picked up on the next tick without a
    // restart. Falls back to the provider's default universe when unset.
    let watchlist: string[] | undefined;
    try {
      const s = await getSettings();
      if (Array.isArray(s.marketWatchlist)) watchlist = s.marketWatchlist;
    } catch (err) {
      console.warn("[worker] watchlist read failed, using defaults:", err instanceof Error ? err.message : err);
    }
    const batch = await getMarketBatch(watchlist);
    lastBatch = batch;
    lastBatchStale = batch.stale;
    lastTickAt = new Date();
    io.emit("market:update", batch);
    io.emit("system:status", { connected: true, serverTime: new Date().toISOString(), stale: batch.stale, tickMs: TICK_MS });
    if (batch.assets.length) {
      const ingestedAt = new Date();
      await persist(batch, ingestedAt);
      const news = await newsCounts(batch.assets.map((a) => a.symbol));
      for (const a of batch.assets) {
        try {
          const context = await loadAssetContext(a, news, batch.stale, ingestedAt);
          await processAssetSignal(a, context);
        } catch (err) {
          console.error(`[worker] signal ${a.symbol} processing failed:`, err instanceof Error ? err.message : err);
        }
      }
    }
    try {
      await evaluateDueSignalOutcomes(lastTickAt);
    } catch (err) {
      console.error("[worker] due outcome evaluation failed:", err instanceof Error ? err.message : err);
    }
  } catch (err) {
    console.error("[worker] tick failed:", err instanceof Error ? err.message : err);
    io.emit("system:status", { connected: true, serverTime: new Date().toISOString(), stale: true, tickMs: TICK_MS });
  } finally {
    running = false;
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.warn("[worker] DATABASE_URL not set — running broadcast-only (no persistence, no signals stored).");
  } else {
    try {
      await getPostgresDb(); // Test connection
    } catch (e) {
      console.warn("[worker] database connection failed:", e instanceof Error ? e.message : e);
    }
  }
  if (config("REALTIME_ONCE") === "true") {
    await tick();
    resetMarketService();
    await closePostgresDb();
    return;
  }
  server.listen(PORT, () => console.log(`[worker] realtime service on :${PORT} (tick ${TICK_MS / 1000}s)`));
  await tick();
  setInterval(() => void tick(), TICK_MS);
}

// warm the cache used by the Next.js app too (same DB, separate process caches)
process.on("SIGTERM", () => {
  console.log("[worker] SIGTERM, shutting down");
  io.close();
  server.close();
  resetMarketService();
  process.exit(0);
});

void main();