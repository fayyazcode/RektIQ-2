/**
 * Signal engine (Phase 4): turns scored snapshots into threshold-crossing
 * events with evidence, expiry and duplicate suppression. Pure decision logic
 * lives here so it can be unit-tested without a database.
 */
import { z } from "zod";
import type { ScoreResult } from "../score/engine";

export const SIGNAL_TYPES = ["bullish", "bearish", "momentum_fade", "volume_spike", "score_shift"] as const;
export type SignalType = (typeof SIGNAL_TYPES)[number];

export const SignalEvidenceSchema = z.object({
  price: z.number().finite(),
  priceChange24h: z.number().finite(),
  volume24h: z.number().finite(),
  marketCap: z.number().finite(),
  score: z.number().int().min(0).max(100),
  components: z.record(z.string(), z.number()),
  volumeRatio: z.number().finite().nullable().optional(),
  newsCount24h: z.number().int().min(0).optional(),
  priceChange15m: z.number().finite().nullable().optional(),
  priceChange1h: z.number().finite().nullable().optional(),
  triggerModel: z.enum(["momentum_acceleration_v1"]).optional(),
  triggerThreshold15mPct: z.number().finite().optional(),
  triggerThreshold1hPct: z.number().finite().optional(),
  triggerMinVolumeRatio: z.number().finite().optional(),
});
export type SignalEvidence = z.infer<typeof SignalEvidenceSchema>;

export const SignalSchema = z.object({
  id: z.string(),
  symbol: z.string().min(1).max(20),
  type: z.enum(SIGNAL_TYPES),
  score: z.number().int().min(0).max(100),
  evidence: SignalEvidenceSchema,
  timestamp: z.string(), // ISO — when the signal fired
  expiresAt: z.string(), // ISO — after which it's historical noise
  formulaVersion: z.string(),
});
export type Signal = z.infer<typeof SignalSchema>;

export const THRESHOLDS = {
  bullishScore: 75,
  bearishScore: 30,
  /** |Δscore| vs the last emitted state within TTL counts as a meaningful shift */
  scoreShiftDelta: 10,
  volumeSpikeRatio: 2.5, // today's volume vs prior baseline
  ttlMs: 6 * 3600_000, // signals live for 6 h
} as const;

/** Short-horizon entry gates; deliberately below the later outcome targets. */
export const EARLY_SIGNAL_THRESHOLDS = {
  largeLiquid: { priceChange15mPct: 0.35, priceChange1hPct: 0.75, minVolumeRatio: 1.05 },
  other: { priceChange15mPct: 1.0, priceChange1hPct: 2.5, minVolumeRatio: 1.15 },
  largeLiquidMarketCapUsd: 10_000_000_000,
  largeLiquidVolume24hUsd: 1_000_000_000,
} as const;

export type SignalInput = {
  symbol: string;
  now: Date;
  result: ScoreResult;
  evidence: SignalEvidence;
  volumeRatio: number | null; // volume24h / prior baseline; null when no baseline
  /** Explicit null means the production worker lacked enough fresh history; never fall back to a late 24h-score trigger. */
  momentum?: { priceChange15m: number; priceChange1h: number } | null;
  previous?: { score: number; types: SignalType[]; emittedAt: Date } | null;
};

function getDirectionalCandidate(input: SignalInput): SignalType | null {
  // Keep compatibility for old callers, while the realtime worker always
  // supplies momentum (or explicit null) and therefore never emits late alerts
  // solely because a trailing 24h score crossed a threshold.
  if (input.momentum === undefined) {
    if (input.result.score >= THRESHOLDS.bullishScore) return "bullish";
    if (input.result.score <= THRESHOLDS.bearishScore) return "bearish";
    return null;
  }
  if (!input.momentum || input.volumeRatio === null) return null;

  const largeLiquid = input.evidence.marketCap >= EARLY_SIGNAL_THRESHOLDS.largeLiquidMarketCapUsd &&
    input.evidence.volume24h >= EARLY_SIGNAL_THRESHOLDS.largeLiquidVolume24hUsd;
  const threshold = largeLiquid ? EARLY_SIGNAL_THRESHOLDS.largeLiquid : EARLY_SIGNAL_THRESHOLDS.other;
  const { priceChange15m, priceChange1h } = input.momentum;
  const volumeConfirmed = input.volumeRatio >= threshold.minVolumeRatio;
  if (!volumeConfirmed) return null;

  // Require both windows to agree and the most recent quarter-hour to be at
  // least as strong as its proportional share of the hourly move (acceleration).
  if (priceChange15m >= threshold.priceChange15mPct &&
      priceChange1h >= threshold.priceChange1hPct &&
      priceChange15m * 4 >= priceChange1h) return "bullish";
  if (priceChange15m <= -threshold.priceChange15mPct &&
      priceChange1h <= -threshold.priceChange1hPct &&
      priceChange15m * 4 <= priceChange1h) return "bearish";
  return null;
}

/**
 * Decide what to emit given the previous signal state. Suppression rules:
 *  - the same (symbol, type) is not re-emitted while its previous instance is unexpired
 *    unless the score moved by ≥ scoreShiftDelta (that becomes a `score_shift` instead);
 *  - at most one new signal per evaluation tick (priority order below).
 */
export function evaluateSignal(input: SignalInput): Omit<Signal, "id">[] {
  const { symbol, now, result, evidence, volumeRatio, previous } = input;
  const out: Omit<Signal, "id">[] = [];
  const nowMs = now.getTime();
  const prevActive = (t: SignalType) =>
    !!previous && previous.types.includes(t) && nowMs - previous.emittedAt.getTime() < THRESHOLDS.ttlMs;

  const mk = (type: SignalType): Omit<Signal, "id"> => ({
    symbol,
    type,
    score: result.score,
    evidence,
    timestamp: now.toISOString(),
    expiresAt: new Date(nowMs + THRESHOLDS.ttlMs).toISOString(),
    formulaVersion: result.formulaVersion,
  });

  const directionalCandidate = getDirectionalCandidate(input);
  if (directionalCandidate && !prevActive(directionalCandidate)) out.push(mk(directionalCandidate));

  if (volumeRatio !== null && volumeRatio >= THRESHOLDS.volumeSpikeRatio && !prevActive("volume_spike")) {
    out.push(mk("volume_spike"));
  }

  // Meaningful threshold crossings take precedence over duplicate suppression:
  // a big move against the last emitted state fires even while that signal is active.
  let shift: Omit<Signal, "id"> | null = null;
  let faded: Omit<Signal, "id"> | null = null;
  if (previous) {
    const delta = Math.abs(result.score - previous.score);
    const crossedBullish = result.score >= THRESHOLDS.bullishScore && previous.score < THRESHOLDS.bullishScore;
    const crossedBearish = result.score <= THRESHOLDS.bearishScore && previous.score > THRESHOLDS.bearishScore;
    // Zone-change semantics: a bullish/bearish signal is only ever emitted from
    // inside its own zone, so prevActive(t) implies the previous score was
    // already in t's zone. "Regime change" therefore means leaving the previous
    // signal's zone (or the previous state having no zone at all):
    //  - prev bullish → score dropped to ≤ bearishScore, or < neutralBelow;
    //  - prev bearish → score rose to ≥ bullishScore, or > neutralAbove;
    //  - prev volume_spike-only → either zone breach counts as a change.
    // Once the prior signal has expired, a still-breaching score is treated as
    // a fresh crossing again (the TTL-suppression window has closed).
    const NEUTRAL_ABOVE = THRESHOLDS.bullishScore - THRESHOLDS.scoreShiftDelta; // 65
    const NEUTRAL_BELOW = THRESHOLDS.bearishScore + THRESHOLDS.scoreShiftDelta; // 40
    const prevZone = previous.types.includes("bullish") ? "bullish" : previous.types.includes("bearish") ? "bearish" : null;
    const changedZone =
      !prevZone ||
      (prevZone === "bullish" && (result.score <= THRESHOLDS.bearishScore || result.score < NEUTRAL_ABOVE)) ||
      (prevZone === "bearish" && (result.score >= THRESHOLDS.bullishScore || result.score > NEUTRAL_BELOW));
    const expired = !prevActive("bullish") && !prevActive("bearish") && !prevActive("volume_spike");
    if ((crossedBullish || crossedBearish || delta >= THRESHOLDS.scoreShiftDelta) && (changedZone || expired)) {
      shift = mk("score_shift");
    }
    if (previous.types.includes("bullish") && result.score < THRESHOLDS.bullishScore - 5) {
      faded = mk("momentum_fade");
    }
  }

  if (out.length) return [out[0]]; // fresh threshold crossing wins the tick
  // Escalation path: an unambiguous regime change (big score move or fade of an
  // active bullish signal) is emitted even while an equivalent signal is
  // unexpired. Same-type repeats stay suppressed so the feed has no duplicates.
  const escalationAllowed = (s: Omit<Signal, "id">) => s.type === "score_shift" || !prevActive(s.type);
  if (shift && escalationAllowed(shift)) return [shift];
  if (faded && escalationAllowed(faded)) return [faded];
  return out;
}

/** Deterministic natural key for duplicate suppression (PostgreSQL unique index). */
export function signalDedupeKey(symbol: string, type: SignalType, emittedAt: Date): string {
  const bucket = Math.floor(emittedAt.getTime() / THRESHOLDS.ttlMs); // one per TTL window
  return `${symbol.toUpperCase()}:${type}:${bucket}`;
}
