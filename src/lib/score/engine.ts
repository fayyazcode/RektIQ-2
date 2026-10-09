/**
 * Deterministic 0–100 Crypto Live Score (Phase 3).
 *
 * Pure functions only: same input → same output, no dates, no randomness, no
 * network. AI may explain these numbers but must never change them.
 *
 * Formula v1 weights: momentum 25 · volume acceleration 20 · liquidity 15 ·
 * volatility 10 · market-cap context 10 · moving-average relation 10 ·
 * news/social activity 10.
 */
import { z } from "zod";

export const FORMULA_VERSION = "score-v1";

export const WEIGHTS = {
  momentum: 25,
  volume: 20,
  liquidity: 15,
  volatility: 10,
  marketCap: 10,
  movingAverage: 10,
  newsSocial: 10,
} as const;

export type ScoreComponentName = keyof typeof WEIGHTS;

export type ScoreInput = {
  priceChange24h: number; // percent
  priceSeries: number[]; // chronological closes (≥2 points improves fidelity)
  volume24h: number; // USD
  avgVolumePrior: number | null; // USD baseline (e.g. trailing mean excluding today); null = unknown
  marketCap: number; // USD
  /** Optional explicit override for the liquidity component (volume/mcap ratio). */
  liquidityRatio?: number | null;
  newsCount24h?: number; // articles mentioning the asset in the last 24 h
  socialScore?: number | null; // 0–100 social activity when a source exists; null = no data
};

export type ScoreResult = {
  score: number; // 0–100 integer
  components: Record<ScoreComponentName, number>; // each 0–100 sub-score
  weighted: Record<ScoreComponentName, number>; // contribution to final score
  formulaVersion: typeof FORMULA_VERSION;
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const finite = (v: unknown): v is number => typeof v === "number" && isFinite(v);

export function mean(xs: number[]): number {
  if (!xs.length) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

export function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return Math.sqrt(s / (xs.length - 1));
}

/** Momentum: −10 %…+10 % maps linearly onto 0…100. */
export function momentumScore(priceChange24h: number): number {
  if (!finite(priceChange24h)) return 50;
  return Math.round(clamp01((priceChange24h + 10) / 20) * 100);
}

/** Volume acceleration: today's volume vs its prior baseline. 1× → 50, ≥2× → 100. */
export function volumeScore(volume24h: number, avgVolumePrior: number | null): number {
  if (!finite(volume24h) || volume24h <= 0) return 0;
  if (avgVolumePrior === null || !finite(avgVolumePrior) || avgVolumePrior <= 0) return 50; // unknown baseline → neutral
  const ratio = volume24h / avgVolumePrior;
  if (ratio <= 0.5) return 0;
  return Math.round(clamp01((ratio - 0.5) / 1.5) * 100); // 0.5→0 … 2.0→100
}

/** Liquidity: daily turnover (volume/market-cap). ≥15 % → 100. */
export function liquidityScore(volume24h: number, marketCap: number, override?: number | null): number {
  const ratio = override !== undefined && override !== null ? override : marketCap > 0 ? volume24h / marketCap : NaN;
  if (!isFinite(ratio) || ratio <= 0) return 0;
  return Math.round(clamp01(ratio / 0.15) * 100);
}

/** Volatility: stdev of returns ÷ |mean return|; low ratio = healthy trend = high score. */
export function volatilityScore(priceSeries: number[]): number {
  const rets: number[] = [];
  for (let i = 1; i < priceSeries.length; i++) {
    const prev = priceSeries[i - 1];
    const cur = priceSeries[i];
    if (finite(prev) && finite(cur) && prev > 0) rets.push((cur - prev) / prev);
  }
  if (rets.length < 2) return 50; // not enough history → neutral
  const m = mean(rets);
  const sd = stddev(rets);
  if (Math.abs(m) < 1e-9) return sd > 0.1 ? 20 : 50;
  const ratio = sd / Math.abs(m);
  if (ratio <= 1) return 100;
  if (ratio >= 4) return 0;
  return Math.round(((4 - ratio) / 3) * 100);
}

/** Market-cap context: mega caps get stability credit, micro caps are penalised. */
export function marketCapScore(marketCap: number): number {
  if (!finite(marketCap) || marketCap <= 0) return 0;
  if (marketCap >= 100e9) return 100;
  if (marketCap >= 10e9) return 85;
  if (marketCap >= 1e9) return 70;
  if (marketCap >= 100e6) return 45;
  if (marketCap >= 10e6) return 25;
  return 10;
}

/** Moving-average relation: premium/discount of last price vs SMA of the series. */
export function movingAverageScore(priceSeries: number[]): number {
  const clean = priceSeries.filter(finite);
  if (clean.length < 2) return 50;
  const sma = mean(clean);
  if (sma <= 0) return 50;
  const dev = (clean[clean.length - 1] - sma) / sma; // −? … +?
  return Math.round(clamp01((dev + 0.1) / 0.2) * 100); // −10 %→0, at SMA→50, +10 %→100
}

/** News/social activity: capped article count blended with an optional social score. */
export function newsSocialScore(newsCount24h: number | undefined, socialScore: number | null | undefined): number {
  const n = finite(newsCount24h) ? Math.max(0, newsCount24h!) : 0;
  const newsPart = Math.min(1, n / 5) * 100; // 5+ articles in 24 h → 100
  if (socialScore === null || socialScore === undefined || !finite(socialScore)) return Math.round(newsPart);
  const soc = clamp01(socialScore / 100) * 100;
  return Math.round((newsPart + soc) / 2);
}

const InputSchema = z.object({
  priceChange24h: z.number().finite(),
  priceSeries: z.array(z.number().finite()),
  volume24h: z.number().finite(),
  avgVolumePrior: z.number().finite().nullable(),
  marketCap: z.number().finite(),
  liquidityRatio: z.number().finite().nullable().optional(),
  newsCount24h: z.number().finite().optional(),
  socialScore: z.number().finite().nullable().optional(),
});

/** Compute the versioned score. Throws on invalid input — callers pass normalized data. */
export function computeScore(raw: ScoreInput): ScoreResult {
  const input = InputSchema.parse(raw);
  const components: Record<ScoreComponentName, number> = {
    momentum: momentumScore(input.priceChange24h),
    volume: volumeScore(input.volume24h, input.avgVolumePrior),
    liquidity: liquidityScore(input.volume24h, input.marketCap, input.liquidityRatio ?? null),
    volatility: volatilityScore(input.priceSeries),
    marketCap: marketCapScore(input.marketCap),
    movingAverage: movingAverageScore(input.priceSeries),
    newsSocial: newsSocialScore(input.newsCount24h, input.socialScore ?? null),
  };
  const weighted = {} as Record<ScoreComponentName, number>;
  let total = 0;
  for (const key of Object.keys(WEIGHTS) as ScoreComponentName[]) {
    weighted[key] = round2((components[key] / 100) * WEIGHTS[key]);
    total += weighted[key];
  }
  return {
    score: Math.min(100, Math.max(0, Math.round(total))),
    components,
    weighted,
    formulaVersion: FORMULA_VERSION,
  };
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Build a ScoreInput straight from a normalized snapshot + derived baselines. */
export function scoreInputFromSnapshot(
  snap: { priceChange24h: number; volume24h: number; marketCap: number; sparkline7d?: number[] },
  opts: { avgVolumePrior?: number | null; newsCount24h?: number; socialScore?: number | null } = {}
): ScoreInput {
  return {
    priceChange24h: snap.priceChange24h,
    priceSeries: snap.sparkline7d ?? [],
    volume24h: snap.volume24h,
    avgVolumePrior: opts.avgVolumePrior ?? null,
    marketCap: snap.marketCap,
    newsCount24h: opts.newsCount24h,
    socialScore: opts.socialScore ?? null,
  };
}
