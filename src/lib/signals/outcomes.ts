import type { SignalOutcomeStage } from "../intel-types";

/** Proposed defaults, kept named so coverage and tiering can be tuned from observed data. */
export const OUTCOME_CONFIG = {
  largeLiquidMarketCapUsd: 10_000_000_000,
  largeLiquidVolume24hUsd: 1_000_000_000,
  largeLiquidMinimumPct: 1.5,
  otherMinimumPct: 5,
  volatilityMultiplier: 1.5,
  volatilityWindowMinutes: 60,
  volatilityMinimumSamples: 10,
  maxSnapshotGapMinutes: 5,
  // Workers sample about once a minute; tolerate occasional missed ticks while
  // still requiring a bounded path so target-crossing order remains meaningful.
  oneHour: { horizonMinutes: 60, minimumSamples: 12, minimumCoverageMinutes: 55 },
  fourHour: { horizonMinutes: 240, minimumSamples: 47, minimumCoverageMinutes: 220 },
} as const;

export type OutcomeSnapshot = {
  timestamp: string | Date;
  price: number;
  volume24h?: number | null;
  volumeQuality?: "outlier";
  stale: boolean;
};

export type OutcomeAssetTierInput = {
  marketCap: number | null;
  volume24h: number | null;
  volumeQuality?: "outlier";
  /** Explicit provider freshness flag for tier evidence captured at signal time. */
  stale: boolean;
};

export type CalculateOutcomeBoundaryInput = {
  asset: OutcomeAssetTierInput;
  signalPrice: number | null;
  signalTime: string | Date;
  assetSnapshots: OutcomeSnapshot[];
};

export type CalculateOutcomeBoundaryResult = {
  tier: "large_liquid" | "other";
  tierMinimumPct: number;
  volatilityRangePct: number | null;
  volatilityAdjustmentPct: number;
  targetPct: number;
};

export type EvaluateSignalOutcomeStageInput = CalculateOutcomeBoundaryInput & {
  direction?: "bullish" | "bearish";
  horizonMinutes: 60 | 240;
  btcSnapshots: OutcomeSnapshot[];
  evaluationTime: string | Date;
};

type ValidSnapshot = OutcomeSnapshot & { timeMs: number };

function timeMs(value: string | Date): number {
  return value instanceof Date ? value.getTime() : Date.parse(value);
}

function validSnapshots(snapshots: OutcomeSnapshot[]): ValidSnapshot[] {
  const byTime = new Map<number, ValidSnapshot>();
  for (const snapshot of snapshots) {
    const t = timeMs(snapshot.timestamp);
    if (snapshot.stale || !Number.isFinite(t) || !Number.isFinite(snapshot.price) || snapshot.price <= 0) continue;
    // Collapse duplicate timestamps deterministically; the first persisted sample wins.
    if (!byTime.has(t)) byTime.set(t, { ...snapshot, timeMs: t });
  }
  return [...byTime.values()].sort((a, b) => a.timeMs - b.timeMs);
}

export function calculateOutcomeBoundary(input: CalculateOutcomeBoundaryInput): CalculateOutcomeBoundaryResult {
  const largeLiquid = input.asset.marketCap !== null && input.asset.volume24h !== null &&
    Number.isFinite(input.asset.marketCap) && Number.isFinite(input.asset.volume24h) &&
    input.asset.marketCap >= OUTCOME_CONFIG.largeLiquidMarketCapUsd &&
    input.asset.volume24h >= OUTCOME_CONFIG.largeLiquidVolume24hUsd &&
    input.asset.volumeQuality !== "outlier" && !input.asset.stale;
  const tier = largeLiquid ? "large_liquid" : "other";
  const tierMinimumPct = largeLiquid ? OUTCOME_CONFIG.largeLiquidMinimumPct : OUTCOME_CONFIG.otherMinimumPct;
  const signalAt = timeMs(input.signalTime);
  const signalPrice = input.signalPrice;
  const from = signalAt - OUTCOME_CONFIG.volatilityWindowMinutes * 60_000;
  const prior = validSnapshots(input.assetSnapshots).filter((s) => s.timeMs >= from && s.timeMs < signalAt);
  const span = prior.length > 1 ? (prior[prior.length - 1].timeMs - prior[0].timeMs) / 60_000 : 0;
  const maxGap = prior.slice(1).reduce((max, item, i) => Math.max(max, (item.timeMs - prior[i].timeMs) / 60_000), 0);
  const enoughHistory = prior.length >= OUTCOME_CONFIG.volatilityMinimumSamples &&
    span >= OUTCOME_CONFIG.volatilityWindowMinutes - OUTCOME_CONFIG.maxSnapshotGapMinutes &&
    maxGap <= OUTCOME_CONFIG.maxSnapshotGapMinutes;
  const volatilityRangePct = enoughHistory && signalPrice !== null && Number.isFinite(signalPrice) && signalPrice > 0
    ? ((Math.max(...prior.map((s) => s.price)) - Math.min(...prior.map((s) => s.price))) / signalPrice) * 100
    : null;
  const volatilityAdjustmentPct = volatilityRangePct === null ? 0 : volatilityRangePct * OUTCOME_CONFIG.volatilityMultiplier;
  return {
    tier, tierMinimumPct, volatilityRangePct, volatilityAdjustmentPct,
    targetPct: Math.max(tierMinimumPct, volatilityAdjustmentPct),
  };
}

function emptyStage(input: EvaluateSignalOutcomeStageInput, status: SignalOutcomeStage["status"], reason: string | null,
  boundary: CalculateOutcomeBoundaryResult, sampleCount = 0, coverageMinutes = 0): SignalOutcomeStage {
  const explainedReason = reason !== null && boundary.volatilityRangePct === null
    ? `${reason} Preceding-hour volatility adjustment was unavailable; the tier minimum was used.`
    : reason;
  return {
    status, horizonMinutes: input.horizonMinutes, ...boundary,
    entryPrice: input.signalPrice, endPrice: null, returnPct: null,
    maxFavorableMovePct: null, maxAdverseMovePct: null, rollingVolumeChangePct: null,
    btcReturnPct: null, sampleCount, coverageMinutes, reason: explainedReason,
    evaluatedAt: Number.isFinite(timeMs(input.evaluationTime)) ? new Date(timeMs(input.evaluationTime)).toISOString() : null,
  };
}

export function evaluateSignalOutcomeStage(input: EvaluateSignalOutcomeStageInput): SignalOutcomeStage {
  const boundary = calculateOutcomeBoundary(input);
  const signalAt = timeMs(input.signalTime);
  const evaluatedAt = timeMs(input.evaluationTime);
  const deadline = signalAt + input.horizonMinutes * 60_000;
  if (!Number.isFinite(signalAt) || !Number.isFinite(evaluatedAt)) {
    return emptyStage(input, "not_evaluated", "Signal or evaluation timestamp is invalid.", boundary);
  }
  if (evaluatedAt < deadline) return emptyStage(input, "pending", null, boundary);
  if (input.signalPrice === null || !Number.isFinite(input.signalPrice) || input.signalPrice <= 0) {
    return emptyStage(input, "not_evaluated", "Signal-time price is unavailable or invalid.", boundary);
  }
  const requirement = input.horizonMinutes === 60 ? OUTCOME_CONFIG.oneHour : OUTCOME_CONFIG.fourHour;
  const samples = validSnapshots(input.assetSnapshots).filter((s) => s.timeMs > signalAt && s.timeMs <= deadline);
  const path = [{ timeMs: signalAt, price: input.signalPrice, volume24h: null as number | null }, ...samples];
  const coverageMinutes = samples.length ? (samples[samples.length - 1].timeMs - signalAt) / 60_000 : 0;
  const maxObservedGap = path.slice(1).reduce((max, item, i) => Math.max(max, (item.timeMs - path[i].timeMs) / 60_000), 0);
  const tailGap = samples.length ? (deadline - samples[samples.length - 1].timeMs) / 60_000 : input.horizonMinutes;
  const maxGap = Math.max(maxObservedGap, tailGap);
  if (samples.length < requirement.minimumSamples || coverageMinutes < requirement.minimumCoverageMinutes ||
    maxGap > OUTCOME_CONFIG.maxSnapshotGapMinutes) {
    const why = samples.length < requirement.minimumSamples
      ? `Only ${samples.length} valid post-signal snapshots were available; ${requirement.minimumSamples} are required.`
      : coverageMinutes < requirement.minimumCoverageMinutes
        ? `Valid snapshots covered ${coverageMinutes.toFixed(1)} minutes; ${requirement.minimumCoverageMinutes} minutes are required.`
        : `A snapshot gap exceeded ${OUTCOME_CONFIG.maxSnapshotGapMinutes} minutes.`;
    return emptyStage(input, "not_evaluated", why, boundary, samples.length, coverageMinutes);
  }
  const upper = input.signalPrice * (1 + boundary.targetPct / 100);
  const lower = input.signalPrice * (1 - boundary.targetPct / 100);
  const direction = input.direction ?? "bullish";
  let status: SignalOutcomeStage["status"] = "mixed";
  let reason = `The ${input.horizonMinutes === 60 ? "one" : "four"}-hour window ended without crossing either boundary.`;
  let resolved = false;
  for (let i = 1; i < path.length; i++) {
    const previous = path[i - 1].price;
    const current = path[i].price;
    const crossedUpper = Math.max(previous, current) >= upper;
    const crossedLower = Math.min(previous, current) <= lower;
    if (crossedUpper && crossedLower) {
      status = "mixed";
      reason = "A sampling interval spanned both outcome boundaries, so their crossing order is unknown.";
      resolved = true;
      break;
    }
    const crossedFavorable = direction === "bullish" ? crossedUpper : crossedLower;
    const crossedAdverse = direction === "bullish" ? crossedLower : crossedUpper;
    if (crossedFavorable) {
      status = "success";
      const favorablePct = direction === "bullish" ? `+${boundary.targetPct.toFixed(1)}%` : `−${boundary.targetPct.toFixed(1)}%`;
      const adversePct = direction === "bullish" ? `−${boundary.targetPct.toFixed(1)}%` : `+${boundary.targetPct.toFixed(1)}%`;
      reason = `Price crossed the favorable ${favorablePct} boundary before the adverse ${adversePct} boundary for this ${direction} signal.`;
      resolved = true;
      break;
    }
    if (crossedAdverse) {
      status = "failed";
      const favorablePct = direction === "bullish" ? `+${boundary.targetPct.toFixed(1)}%` : `−${boundary.targetPct.toFixed(1)}%`;
      const adversePct = direction === "bullish" ? `−${boundary.targetPct.toFixed(1)}%` : `+${boundary.targetPct.toFixed(1)}%`;
      reason = `Price crossed the adverse ${adversePct} boundary before the favorable ${favorablePct} boundary for this ${direction} signal.`;
      resolved = true;
      break;
    }
  }
  const end = path[path.length - 1];
  const prices = path.map((s) => s.price);
  const highestPrice = Math.max(...prices);
  const lowestPrice = Math.min(...prices);
  const returnPct = ((end.price - input.signalPrice) / input.signalPrice) * 100;
  const volumeStart = samples.find((s) => typeof s.volume24h === "number" && s.volume24h! > 0 && s.volumeQuality !== "outlier");
  const volumeEnd = [...samples].reverse().find((s) => typeof s.volume24h === "number" && s.volume24h! > 0 && s.volumeQuality !== "outlier");
  const rollingVolumeChangePct = volumeStart && volumeEnd
    ? ((volumeEnd.volume24h! - volumeStart.volume24h!) / volumeStart.volume24h!) * 100 : null;
  const btcSnapshots = validSnapshots(input.btcSnapshots);
  const btcStart = [...btcSnapshots].reverse().find((s) => s.timeMs <= signalAt && signalAt - s.timeMs <= OUTCOME_CONFIG.maxSnapshotGapMinutes * 60_000);
  const btcEnd = [...btcSnapshots].reverse().find((s) => s.timeMs > signalAt && s.timeMs <= deadline);
  const btcEndIsFresh = btcEnd !== undefined && deadline - btcEnd.timeMs <= OUTCOME_CONFIG.maxSnapshotGapMinutes * 60_000;
  const btcReturnPct = btcStart && btcEnd && btcEndIsFresh
    ? ((btcEnd.price - btcStart.price) / btcStart.price) * 100
    : null;
  if (boundary.volatilityRangePct === null) reason += " Preceding-hour volatility adjustment was unavailable; the tier minimum was used.";
  if (btcReturnPct === null) reason += " BTC benchmark data was unavailable.";
  return {
    status, horizonMinutes: input.horizonMinutes, ...boundary, entryPrice: input.signalPrice,
    endPrice: end.price, returnPct,
    maxFavorableMovePct: direction === "bullish"
      ? ((highestPrice - input.signalPrice) / input.signalPrice) * 100
      : ((input.signalPrice - lowestPrice) / input.signalPrice) * 100,
    maxAdverseMovePct: direction === "bullish"
      ? ((lowestPrice - input.signalPrice) / input.signalPrice) * 100
      : ((input.signalPrice - highestPrice) / input.signalPrice) * 100,
    rollingVolumeChangePct, btcReturnPct, sampleCount: samples.length, coverageMinutes,
    reason, evaluatedAt: new Date(evaluatedAt).toISOString(),
  };
}
