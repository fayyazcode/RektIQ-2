/**
 * Anomaly engine (Phase 5). Every anomaly compares the current value against a
 * defined historical baseline — no baseline, no anomaly. Pure functions; the
 * worker supplies baselines computed from stored market_snapshots.
 */
import type { AssetSnapshot } from "../market/types";

export const ANOMALY_TYPES = [
  "unusual_volume",
  "rapid_price_move",
  "abnormal_volatility",
  "liquidity_change",
  "marketcap_change",
  "news_surge",
  "social_surge",
] as const;
export type AnomalyType = (typeof ANOMALY_TYPES)[number];

export type Anomaly = {
  id: string;
  symbol: string;
  type: AnomalyType;
  severity: "low" | "medium" | "high";
  observed: number;
  baseline: number;
  ratio: number; // observed / baseline (or absolute delta for price moves)
  description: string; // neutral, factual wording
  timestamp: string; // ISO
  baselineWindowHours: number; // how much history the baseline used
  formulaVersion: string;
};

export const ANOMALY_FORMULA_VERSION = "anomaly-v1";

/** Baselines over a trailing window, excluding the current sample. */
export type Baseline = {
  avgVolume: number | null;
  stdevVolume: number | null;
  avgVolatility: number | null; // mean of |return| per interval
  avgLiquidityRatio: number | null;
  avgMarketCap: number | null;
  newsRatePerHour: number | null;
  windowHours: number;
};

const finite = (v: unknown): v is number => typeof v === "number" && isFinite(v);

/** Decode the normalized AssetSnapshot stored in market_snapshots.snapshot. */
export function parseStoredAssetSnapshot(symbol: string, value: unknown): AssetSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const snapshot = value as Record<string, unknown>;
  if (
    typeof snapshot.name !== "string" ||
    !finite(snapshot.price) ||
    !finite(snapshot.priceChange24h) ||
    !finite(snapshot.marketCap) ||
    !finite(snapshot.volume24h) ||
    !finite(snapshot.liquidity) ||
    typeof snapshot.timestamp !== "string" ||
    typeof snapshot.provider !== "string"
  ) return null;
  const optionalNumbers = ["high24h", "low24h", "ath", "circulatingSupply", "totalSupply", "maxSupply", "fdv", "rank"] as const;
  const optional: Partial<Pick<AssetSnapshot, typeof optionalNumbers[number]>> = {};
  for (const key of optionalNumbers) {
    if (snapshot[key] !== undefined) {
      if (!finite(snapshot[key])) return null;
      optional[key] = snapshot[key];
    }
  }
  if (snapshot.volumeQuality !== undefined && snapshot.volumeQuality !== "outlier") return null;
  if (snapshot.sparkline7d !== undefined &&
    (!Array.isArray(snapshot.sparkline7d) || !snapshot.sparkline7d.every(finite))) return null;
  return {
    symbol,
    name: snapshot.name,
    price: snapshot.price,
    priceChange24h: snapshot.priceChange24h,
    marketCap: snapshot.marketCap,
    volume24h: snapshot.volume24h,
    liquidity: snapshot.liquidity,
    timestamp: snapshot.timestamp,
    provider: snapshot.provider,
    ...optional,
    ...(snapshot.volumeQuality === "outlier" ? { volumeQuality: "outlier" as const } : {}),
    ...(Array.isArray(snapshot.sparkline7d) ? { sparkline7d: snapshot.sparkline7d } : {}),
  };
}

export function mean(xs: number[]): number | null {
  const clean = xs.filter(finite);
  if (!clean.length) return null;
  return clean.reduce((a, b) => a + b, 0) / clean.length;
}

export function stdev(xs: number[]): number | null {
  const clean = xs.filter(finite);
  if (clean.length < 2) return null;
  const m = mean(clean)!;
  return Math.sqrt(clean.reduce((a, b) => a + (b - m) ** 2, 0) / (clean.length - 1));
}

/** Returns (fractional changes) between consecutive samples. */
export function returns(series: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < series.length; i++) {
    if (finite(series[i - 1]) && finite(series[i]) && series[i - 1] > 0) out.push((series[i] - series[i - 1]) / series[i - 1]);
  }
  return out;
}

/** Build a baseline from historical snapshots (chronological, oldest first). */
export function computeBaseline(history: Pick<AssetSnapshot, "volume24h" | "price" | "liquidity" | "marketCap">[], windowHours: number): Baseline {
  const vols = history.map((h) => h.volume24h);
  const rets = returns(history.map((h) => h.price)).map(Math.abs);
  return {
    avgVolume: mean(vols),
    stdevVolume: stdev(vols),
    avgVolatility: mean(rets),
    avgLiquidityRatio: mean(history.map((h) => h.liquidity)),
    avgMarketCap: mean(history.map((h) => h.marketCap)),
    newsRatePerHour: null, // filled by the caller when news history exists
    windowHours,
  };
}

export type AnomalyCandidate = Omit<Anomaly, "id">;

function sev(ratio: number, medium: number, high: number): "low" | "medium" | "high" {
  return ratio >= high ? "high" : ratio >= medium ? "medium" : "low";
}

/**
 * Detect anomalies for one asset. Each check requires a non-null baseline;
 * missing baselines are skipped (never guessed).
 */
export function detectAnomalies(snap: AssetSnapshot, base: Baseline, newsCount24h: number | null): AnomalyCandidate[] {
  const out: AnomalyCandidate[] = [];
  const ts = new Date().toISOString();
  const common = { symbol: snap.symbol, timestamp: ts, baselineWindowHours: base.windowHours, formulaVersion: ANOMALY_FORMULA_VERSION };

  // Unusual volume: z-score against the trailing distribution (needs ≥2 samples for stdev,
  // otherwise fall back to a plain ratio rule once the baseline itself is trusted).
  if (base.avgVolume !== null && base.avgVolume > 0) {
    const ratio = snap.volume24h / base.avgVolume;
    const z = base.stdevVolume && base.stdevVolume > 0 ? (snap.volume24h - base.avgVolume) / base.stdevVolume : null;
    if (ratio >= 2 || (z !== null && z >= 3)) {
      out.push({
        ...common,
        type: "unusual_volume",
        severity: sev(ratio, 3, 5),
        observed: snap.volume24h,
        baseline: base.avgVolume,
        ratio: round2(ratio),
        description: `24h volume is ${round2(ratio)}× the ${base.windowHours}h average.`,
      });
    }
  }

  // Rapid price movement uses an absolute threshold — the "baseline" is the flat 0 % reference.
  if (Math.abs(snap.priceChange24h) >= 8) {
    out.push({
      ...common,
      type: "rapid_price_move",
      severity: sev(Math.abs(snap.priceChange24h) / 8, 1.5, 2.5),
      observed: snap.priceChange24h,
      baseline: 0,
      ratio: round2(Math.abs(snap.priceChange24h) / 8),
      description: `Price moved ${snap.priceChange24h > 0 ? "+" : ""}${round2(snap.priceChange24h)}% in 24h (threshold ±8%).`,
    });
  }

  // Abnormal volatility: current realized vol vs trailing mean vol.
  const curVol = mean(returns(snap.sparkline7d ?? []).map(Math.abs));
  if (curVol !== null && base.avgVolatility !== null && base.avgVolatility > 0) {
    const ratio = curVol / base.avgVolatility;
    if (ratio >= 2.5) {
      out.push({
        ...common,
        type: "abnormal_volatility",
        severity: sev(ratio, 4, 6),
        observed: round6(curVol),
        baseline: round6(base.avgVolatility),
        ratio: round2(ratio),
        description: `Short-term volatility is ${round2(ratio)}× its recent average.`,
      });
    }
  }

  // Liquidity turnover change.
  if (base.avgLiquidityRatio !== null && base.avgLiquidityRatio > 0 && snap.liquidity > 0) {
    const ratio = snap.liquidity / base.avgLiquidityRatio;
    if (ratio >= 2 || ratio <= 0.4) {
      out.push({
        ...common,
        type: "liquidity_change",
        severity: ratio >= 3 || ratio <= 0.25 ? "high" : "medium",
        observed: round6(snap.liquidity),
        baseline: round6(base.avgLiquidityRatio),
        ratio: round2(ratio),
        description: `Turnover (volume/market-cap) is ${round2(ratio)}× its recent average.`,
      });
    }
  }

  // Market-cap regime change.
  if (base.avgMarketCap !== null && base.avgMarketCap > 0 && snap.marketCap > 0) {
    const ratio = snap.marketCap / base.avgMarketCap;
    if (Math.abs(ratio - 1) >= 0.1) {
      out.push({
        ...common,
        type: "marketcap_change",
        severity: Math.abs(ratio - 1) >= 0.25 ? "high" : "medium",
        observed: snap.marketCap,
        baseline: base.avgMarketCap,
        ratio: round2(ratio),
        description: `Market cap changed ${ratio >= 1 ? "+" : ""}${Math.round((ratio - 1) * 100)}% vs its ${base.windowHours}h average.`,
      });
    }
  }

  // News surge: needs a defined hourly news-rate baseline.
  if (newsCount24h !== null && base.newsRatePerHour !== null && base.newsRatePerHour > 0) {
    const ratio = newsCount24h / 24 / base.newsRatePerHour;
    if (ratio >= 3) {
      out.push({
        ...common,
        type: "news_surge",
        severity: sev(ratio, 6, 10),
        observed: newsCount24h,
        baseline: Math.round(base.newsRatePerHour * 24),
        ratio: round2(ratio),
        description: `Coverage rate is ${round2(ratio)}× this asset's usual daily news flow.`,
      });
    }
  }

  return out;
}

/** Social surge — only emitted when a social-data source actually exists. */
export function socialSurgeAnomaly(snap: AssetSnapshot, currentSocialScore: number, baselineSocialScore: number | null): AnomalyCandidate | null {
  if (baselineSocialScore === null || baselineSocialScore <= 0) return null;
  const ratio = currentSocialScore / baselineSocialScore;
  if (ratio < 2.5) return null;
  return {
    symbol: snap.symbol,
    type: "social_surge",
    severity: sev(ratio, 4, 6),
    observed: currentSocialScore,
    baseline: baselineSocialScore,
    ratio: round2(ratio),
    description: `Social activity is ${round2(ratio)}× its recent baseline.`,
    timestamp: new Date().toISOString(),
    baselineWindowHours: 24,
    formulaVersion: ANOMALY_FORMULA_VERSION,
  };
}

/** Suppress repeats: same symbol+type inside the cooldown is not a new anomaly. */
export function isNewAnomaly(existing: { type: string; timestamp: string }[], candidate: AnomalyCandidate, cooldownMs: number, now = Date.now()): boolean {
  const cutoff = now - cooldownMs;
  return !existing.some((e) => e.type === candidate.type && new Date(e.timestamp).getTime() >= cutoff);
}

const round2 = (v: number) => Math.round(v * 100) / 100;
const round6 = (v: number) => Math.round(v * 1e6) / 1e6;
