/**
 * Read models for the market intelligence layer (used by API routes and pages).
 * Follows the existing queries.ts philosophy: never crash the caller — on DB
 * failure return empty results plus a `stale`/error indicator. Fresh market
 * overviews come from the market service (provider + TTL cache); history comes
 * from PostgreSQL, where the realtime worker persists it.
 */
import "server-only";
import { sql, and, inArray } from "drizzle-orm";
import { getMarketBatch } from "../market/service";
import type { MarketBatch } from "../market/types";
import { computeScore, scoreInputFromSnapshot } from "../score/engine";
import { getPostgresDb } from "../db/client";
import * as schema from "../db/schema";

export const INTEL_TAG = "intel";
const INTEL_QUERY_TIMEOUT_MS = 8_000;

function withQueryTimeout<T>(query: PromiseLike<T>, name: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`${name} query timed out after ${INTEL_QUERY_TIMEOUT_MS}ms`)),
      INTEL_QUERY_TIMEOUT_MS
    );
    Promise.resolve(query).then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      }
    );
  });
}

/* ── View models (JSON-safe) ──────────────────────────────── */

export type AssetView = {
  symbol: string;
  name: string;
  price: number;
  priceChange24h: number;
  marketCap: number;
  volume24h: number;
  liquidity: number;
  volumeQuality?: "outlier";
  fdv?: number;
  rank?: number;
  sparkline7d?: number[];
  score: number | null;
  scoreEstimated: boolean;
  scoreComponents: Record<string, number> | null;
  formulaVersion: string | null;
  timestamp: string;
  provider: string;
};

export type OverviewView = {
  assets: AssetView[];
  fetchedAt: string;
  provider: string;
  stale: boolean;
  error?: string;
  breadth: { up: number; down: number; flat: number };
  totalVolume: number;
};

export type SignalOutcomeStage = {
  status: "pending" | "success" | "failed" | "mixed" | "not_evaluated";
  horizonMinutes: 60 | 240;
  tier: "large_liquid" | "other";
  tierMinimumPct: number;
  volatilityRangePct: number | null;
  volatilityAdjustmentPct: number;
  targetPct: number;
  entryPrice: number | null;
  endPrice: number | null;
  returnPct: number | null;
  maxFavorableMovePct: number | null;
  maxAdverseMovePct: number | null;
  rollingVolumeChangePct: number | null;
  btcReturnPct: number | null;
  sampleCount: number;
  coverageMinutes: number;
  reason: string | null;
  evaluatedAt: string | null;
};

export type SignalOutcome = {
  oneHour?: SignalOutcomeStage;
  fourHour?: SignalOutcomeStage;
};

export type SignalView = {
  id: string;
  symbol: string;
  type: string;
  score: number;
  evidence: Record<string, unknown>;
  timestamp: string;
  expiresAt: string;
  formulaVersion: string;
  // outcome is fetched separately from marketSignalOutcomes table
  outcome?: SignalOutcome;
};

function toSignalView(doc: typeof schema.marketSignals.$inferSelect): SignalView {
  return {
    id: doc.id,
    symbol: doc.symbol,
    type: doc.type,
    score: doc.score,
    evidence: doc.evidence,
    timestamp: doc.occurredAt.toISOString(),
    expiresAt: doc.expiresAt.toISOString(),
    formulaVersion: doc.formulaVersion,
    outcome: undefined, // outcome is stored in separate marketSignalOutcomes table
  };
}

async function attachSignalOutcomes(signals: SignalView[]): Promise<SignalView[]> {
  if (!signals.length) return signals;

  try {
    const db = getPostgresDb();
    const rows = await withQueryTimeout(
      db
        .select()
        .from(schema.marketSignalOutcomes)
        .where(inArray(schema.marketSignalOutcomes.signalId, signals.map((signal) => signal.id))),
      "signal outcomes"
    );
    const outcomes = new Map<string, SignalOutcome>();

    for (const row of rows) {
      const stage: SignalOutcomeStage = {
        status: row.status,
        horizonMinutes: row.horizonMinutes,
        tier: row.tier,
        tierMinimumPct: row.tierMinimumPct,
        volatilityRangePct: row.volatilityRangePct,
        volatilityAdjustmentPct: row.volatilityAdjustmentPct,
        targetPct: row.targetPct,
        entryPrice: row.entryPrice,
        endPrice: row.endPrice,
        returnPct: row.returnPct,
        maxFavorableMovePct: row.maxFavorableMovePct,
        maxAdverseMovePct: row.maxAdverseMovePct,
        rollingVolumeChangePct: row.rollingVolumeChangePct,
        btcReturnPct: row.btcReturnPct,
        sampleCount: row.sampleCount,
        coverageMinutes: row.coverageMinutes,
        reason: row.reason,
        evaluatedAt: row.evaluatedAt?.toISOString() ?? null,
      };
      const outcome = outcomes.get(row.signalId) ?? {};
      if (row.horizonMinutes === 60) outcome.oneHour = stage;
      else if (row.horizonMinutes === 240) outcome.fourHour = stage;
      outcomes.set(row.signalId, outcome);
    }

    return signals.map((signal) => ({
      ...signal,
      ...(outcomes.has(signal.id) ? { outcome: outcomes.get(signal.id) } : {}),
    }));
  } catch (err) {
    console.warn("[intel] signal outcomes unavailable:", err instanceof Error ? err.message : err);
    return signals;
  }
}

export type AnomalyView = SignalView & {
  severity: string;
  observed: number;
  baseline: number;
  ratio: number;
  description: string;
  baselineWindowHours?: number;
};

export type NewsImpactView = {
  id: string;
  symbol: string;
  headline: string;
  source: string;
  url: string;
  publishedAt: string;
  windowMinutes: number;
  priceBefore: number;
  priceAfter: number;
  priceChangePct: number;
  volumeReactionRatio: number | null;
  computedAt: string;
  formulaVersion: string;
};

export type DegenRow = {
  symbol: string;
  name: string;
  price: number;
  priceChange24h: number;
  volume24h: number;
  marketCap: number;
  fdv: number | null;
  volMcapRatio: number;
  liquidity: number;
  volumeQuality?: "outlier";
  sparkline7d?: number[];
  score: number | null;
  scoreEstimated: boolean;
  anomaly: string | null; // latest open anomaly type, if any
  rank: number | null;
  timestamp: string;
  provider: string;
};

/* ── Queries ──────────────────────────────────────────────── */

async function scoredAssets(symbols?: string[]): Promise<Map<string, { score: number; components: Record<string, number>; formulaVersion: string }>> {
  const out = new Map<string, { score: number; components: Record<string, number>; formulaVersion: string }>();
  try {
    const db = getPostgresDb();
    const query = db.select({
      symbol: schema.assets.symbol,
      score: schema.assets.score,
      scoreComponents: schema.assets.scoreComponents,
      formulaVersion: schema.assets.formulaVersion
    }).from(schema.assets);
    const docs = await withQueryTimeout(
      symbols?.length ? query.where(inArray(schema.assets.symbol, symbols)) : query,
      "asset scores"
    );

    for (const doc of docs) {
      out.set(doc.symbol, {
        score: doc.score,
        components: doc.scoreComponents ?? {},
        formulaVersion: doc.formulaVersion
      });
    }
  } catch (err) {
    console.warn("[intel] asset scores unavailable:", err instanceof Error ? err.message : err);
  }
  return out;
}

function toAssetViews(batch: MarketBatch, scores: Awaited<ReturnType<typeof scoredAssets>>): AssetView[] {
  return batch.assets.map((a) => {
    const s = scores.get(a.symbol);
    const estimated = s ? null : computeScore(scoreInputFromSnapshot(a));
    return {
      symbol: a.symbol,
      name: a.name,
      price: a.price,
      priceChange24h: a.priceChange24h,
      marketCap: a.marketCap,
      volume24h: a.volume24h,
      liquidity: a.liquidity,
      ...(a.volumeQuality ? { volumeQuality: a.volumeQuality } : {}),
      ...(a.fdv !== undefined ? { fdv: a.fdv } : {}),
      ...(a.rank !== undefined ? { rank: a.rank } : {}),
      ...(a.sparkline7d ? { sparkline7d: a.sparkline7d.slice(-84) } : {}), // ~2h granularity for transport
      score: s?.score ?? estimated!.score,
      scoreEstimated: !s,
      scoreComponents: s?.components ?? estimated!.components,
      formulaVersion: s?.formulaVersion ?? estimated!.formulaVersion,
      timestamp: a.timestamp,
      provider: a.provider,
    };
  });
}

/** Tracked-market overview with scores merged in. Falls back to stale cache. */
export async function getOverview(symbols?: string[]): Promise<OverviewView> {
  const [batch, scores] = await Promise.all([getMarketBatch(symbols), scoredAssets(symbols)]);
  const assets = toAssetViews(batch, scores);
  let up = 0;
  let down = 0;
  for (const a of assets) (a.priceChange24h > 0.05 ? up++ : a.priceChange24h < -0.05 ? down++ : 0);
  return {
    assets,
    fetchedAt: batch.fetchedAt,
    provider: batch.provider,
    stale: batch.stale,
    ...(batch.error ? { error: batch.error } : {}),
    breadth: { up, down, flat: assets.length - up - down },
    totalVolume: assets.reduce((s, a) => s + a.volume24h, 0),
  };
}

export async function getAssetDetail(symbol: string): Promise<{ asset: AssetView | null; anomalies: AnomalyView[]; signals: SignalView[]; chartSignals: SignalView[]; newsImpacts: NewsImpactView[] }> {
  const upper = symbol.toUpperCase();
  const [overview, anomalies, chartSignals, impacts] = await Promise.all([
    getOverview([upper]),
    listAnomalies({ symbol: upper, limit: 10 }),
    listSignals({ symbol: upper, limit: 100 }),
    listNewsImpacts({ symbol: upper, limit: 10 }),
  ]);
  const asset = overview.assets.find((a) => a.symbol === upper) ?? null;
  return { asset, anomalies, signals: chartSignals.slice(0, 10), chartSignals, newsImpacts: impacts };
}

/* ── Paginated event lists ────────────────────────────────── */

export type ListOpts = { symbol?: string; type?: string; limit?: number; before?: string };

export async function listSignals(opts: ListOpts = {}): Promise<SignalView[]> {
  try {
    const db = getPostgresDb();
    const conditions = [];

    if (opts.symbol) conditions.push(sql`${schema.marketSignals.symbol} = ${opts.symbol.toUpperCase()}`);
    if (opts.type) conditions.push(sql`${schema.marketSignals.type} = ${opts.type}`);
    if (opts.before) conditions.push(sql`${schema.marketSignals.expiresAt} > ${new Date(opts.before)}`);

    const docs = await withQueryTimeout(
      db
        .select()
        .from(schema.marketSignals)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(sql`${schema.marketSignals.occurredAt} DESC`)
        .limit(Math.min(100, opts.limit ?? 30)),
      "signals"
    );

    return attachSignalOutcomes(docs.map(toSignalView));
  } catch (err) {
    console.warn("[intel] signals unavailable:", err instanceof Error ? err.message : err);
    return [];
  }
}

/** Full signal record used by its detail page. */
export async function getSignalById(id: string): Promise<SignalView | null> {
  try {
    if (!/^[a-f\d]{8,64}$/i.test(id)) return null;

    const db = getPostgresDb();
    const doc = await db.select().from(schema.marketSignals).where(sql`${schema.marketSignals.id} = ${id}`).limit(1);

    if (!doc.length) return null;
    const [signal] = await attachSignalOutcomes([toSignalView(doc[0])]);
    return signal;
  } catch (err) {
    console.warn("[intel] signal detail unavailable:", err instanceof Error ? err.message : err);
    return null;
  }
}

export async function listAnomalies(opts: ListOpts = {}): Promise<AnomalyView[]> {
  try {
    const db = getPostgresDb();
    const conditions = [];

    if (opts.symbol) conditions.push(sql`${schema.anomalies.symbol} = ${opts.symbol.toUpperCase()}`);
    if (opts.type) conditions.push(sql`${schema.anomalies.type} = ${opts.type}`);
    if (opts.before) conditions.push(sql`${schema.anomalies.occurredAt} > ${new Date(opts.before)}`);

    const docs = await withQueryTimeout(
      db
        .select()
        .from(schema.anomalies)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(sql`${schema.anomalies.occurredAt} DESC`)
        .limit(Math.min(100, opts.limit ?? 30)),
      "anomalies"
    );

    return docs.map((d) => ({
      id: d.id,
      symbol: d.symbol,
      type: d.type,
      score: 0,
      evidence: { observed: d.observed, baseline: d.baseline, ratio: d.ratio },
      timestamp: d.occurredAt.toISOString(),
      expiresAt: d.occurredAt.toISOString(),
      formulaVersion: d.formulaVersion,
      severity: d.severity,
      observed: d.observed,
      baseline: d.baseline,
      ratio: d.ratio,
      description: d.description,
      baselineWindowHours: d.baselineWindowHours,
    }));
  } catch (err) {
    console.warn("[intel] anomalies unavailable:", err instanceof Error ? err.message : err);
    return [];
  }
}

export async function listNewsImpacts(opts: ListOpts & { id?: string } = {}): Promise<NewsImpactView[]> {
  try {
    const db = getPostgresDb();
    const conditions = [];

    if (opts.id) conditions.push(sql`${schema.newsImpacts.id} = ${opts.id}`);
    if (opts.symbol) conditions.push(sql`${schema.newsImpacts.symbol} = ${opts.symbol.toUpperCase()}`);
    if (opts.before) conditions.push(sql`${schema.newsImpacts.publishedAt} > ${new Date(opts.before)}`);

    const docs = await withQueryTimeout(
      db
        .select()
        .from(schema.newsImpacts)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(sql`${schema.newsImpacts.publishedAt} DESC`)
        .limit(Math.min(100, opts.limit ?? 30)),
      "news impacts"
    );

    return docs.map((d) => ({
      id: d.id,
      symbol: d.symbol,
      headline: d.headline,
      source: d.source,
      url: d.url,
      publishedAt: d.publishedAt.toISOString(),
      windowMinutes: d.windowMinutes,
      priceBefore: d.priceBefore,
      priceAfter: d.priceAfter,
      priceChangePct: d.priceChangePct,
      volumeBefore: d.volumeBefore,
      volumeAfter: d.volumeAfter,
      volumeReactionRatio: d.volumeReactionRatio,
      computedAt: d.computedAt.toISOString(),
      formulaVersion: d.formulaVersion,
    }));
  } catch (err) {
    console.warn("[intel] news impacts unavailable:", err instanceof Error ? err.message : err);
    return [];
  }
}

/** Degen Radar (Phase 11): small-cap, high-turnover slice of the tracked universe. */
export async function getDegenRadar(maxMarketCap = 500_000_000): Promise<DegenRow[]> {
  const overview = await getOverview();
  const recent = await listAnomalies({ limit: 60 });
  const lastAnomaly = new Map<string, string>();
  for (const a of recent) if (!lastAnomaly.has(a.symbol)) lastAnomaly.set(a.symbol, a.type);
  return overview.assets
    .filter((a) => a.marketCap > 0 && a.marketCap <= maxMarketCap)
    .map((a) => ({
      symbol: a.symbol,
      name: a.name,
      price: a.price,
      priceChange24h: a.priceChange24h,
      volume24h: a.volume24h,
      marketCap: a.marketCap,
      fdv: a.fdv ?? null,
      volMcapRatio: a.liquidity,
      liquidity: a.liquidity,
      ...(a.volumeQuality ? { volumeQuality: a.volumeQuality } : {}),
      ...(a.sparkline7d ? { sparkline7d: a.sparkline7d } : {}),
      // The worker scores the configured watchlist, while Degen can include
      // untracked assets from the provider's broader market universe. Give
      // those rows a transparent live estimate so the Score column is useful.
      score: a.score ?? computeScore(scoreInputFromSnapshot(a)).score,
      scoreEstimated: a.score === null,
      anomaly: lastAnomaly.get(a.symbol) ?? null,
      rank: a.rank ?? null,
      timestamp: a.timestamp,
      provider: a.provider,
    }))
    .sort((x, y) => y.volMcapRatio - x.volMcapRatio)
    .slice(0, 30);
}

export async function getProviderHealthList() {
  try {
    const db = getPostgresDb();
    const docs = await db.select().from(schema.providerHealth)
      .orderBy(sql`${schema.providerHealth.updatedAt} DESC`)
      .limit(20);

    return docs.map((d) => ({
      provider: d.providerId,
      requests: d.requests,
      errors: d.errors,
      rateLimits: d.rateLimits,
      lastSuccessAt: d.lastSuccessAt?.toISOString() ?? null,
      lastFailureAt: d.lastFailureAt?.toISOString() ?? null,
      lastError: d.lastError,
      avgLatencyMs: d.avgLatencyMs,
      stale: d.stale,
      updatedAt: d.updatedAt.toISOString(),
    }));
  } catch (err) {
    console.warn("[intel] provider health unavailable:", err instanceof Error ? err.message : err);
    return [];
  }
}