/**
 * PostgreSQL intelligence-layer types. `*Doc` is a stored shape with UUIDs
 * represented as strings and timestamps represented as Date values.
 */
import type { AssetSnapshot } from "./market/types";

/** One provider snapshot per asset per tick (TTL-cleaned by the cleanup job). */
export type MarketSnapshotDoc = AssetSnapshot & {
  id: string;
  ingestedAt: Date;
  /** Whether the provider batch was served from stale cache rather than a fresh fetch. */
  batchStale?: boolean;
};

/** Current state of a tracked asset + its latest score (upserted per symbol). */
export type AssetStateDoc = {
  _id: string; // uppercase symbol
  name: string;
  last: AssetSnapshot;
  baselineVolume: number | null; // trailing average used for volume acceleration
  score: number;
  scoreComponents: Record<string, number>;
  formulaVersion: string;
  scoredAt: Date;
  updatedAt: Date;
};

/** Signal event (Phase 4). `dedupeKey` has a unique index → duplicate-proof. */
export type SignalDoc = {
  id: string;
  dedupeKey: string; // SYMBOL:type:ttl-bucket
  symbol: string;
  type: string;
  score: number;
  evidence: Record<string, unknown>;
  timestamp: Date;
  expiresAt: Date;
  formulaVersion: string;
  createdAt: Date;
  outcome?: SignalOutcome;
};

/** Retrospective result for one bullish or bearish signal checkpoint. Stored values remain JSON-safe. */
export type SignalOutcomeStatus = "pending" | "success" | "failed" | "mixed" | "not_evaluated";

export type SignalOutcomeStage = {
  status: SignalOutcomeStatus;
  horizonMinutes: number;
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

export type SignalOutcome = { oneHour?: SignalOutcomeStage; fourHour?: SignalOutcomeStage };

/** Anomaly event (Phase 5). `dedupeKey` unique within cooldown bucket. */
export type AnomalyDoc = {
  id: string;
  dedupeKey: string; // SYMBOL:type:cooldown-bucket
  symbol: string;
  type: string;
  severity: "low" | "medium" | "high";
  observed: number;
  baseline: number;
  ratio: number;
  description: string;
  timestamp: Date;
  baselineWindowHours: number;
  formulaVersion: string;
  createdAt: Date;
};

/** article ↔ asset relationship produced by the news correlation job (Phase 9). */
export type NewsEntityDoc = {
  id: string;
  articleId: string;
  storyId: string | null;
  symbol: string; // normalized ticker
  title: string;
  url: string;
  source: string;
  publishedAt: Date;
  createdAt: Date;
};

/** Observed market movement after an article was published. Correlation only. */
export type NewsImpactDoc = {
  id: string;
  articleId: string;
  symbol: string;
  headline: string;
  source: string;
  url: string;
  publishedAt: Date;
  windowMinutes: number; // observation window after publication
  priceBefore: number;
  priceAfter: number;
  priceChangePct: number; // observed movement, not causation
  volumeBefore: number; // avg per interval before
  volumeAfter: number; // avg per interval after
  volumeReactionRatio: number | null;
  computedAt: Date;
  formulaVersion: string;
};

/** Stored AI explanation (Phase 10). Provider/model/prompt version always recorded. */
export type AiAnalysisDoc = {
  id: string;
  kind: "signal" | "news_impact" | "x_post";
  refType: "signal" | "anomaly" | "news_impact" | "asset";
  refId: string;
  symbol: string;
  inputHash: string; // hash of normalized evidence → cache key
  result: {
    signalLabel: string;
    confidence: "low" | "medium" | "high";
    summary: string;
    evidence: string[];
    caveats: string[];
  };
  provider: string; // "jev" | "gemini" | "groq" | "rules"
  model: string;
  promptVersion: string;
  createdAt: Date;
  updatedAt: Date;
};

/** Mirrored provider health (Phase 13); written by the worker, read by admin API. */
export type ProviderHealthDoc = {
  _id: string; // provider id
  requests: number;
  errors: number;
  rateLimits: number;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  lastError: string | null;
  avgLatencyMs: number;
  stale: boolean;
  updatedAt: Date;
};
