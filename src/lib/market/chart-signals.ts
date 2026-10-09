import type { SeriesMarker, UTCTimestamp } from "lightweight-charts";

export type ChartSignal = {
  id: string;
  type: "BULLISH" | "BEARISH";
  /** Unix seconds or milliseconds. Normalized to seconds before chart use. */
  timestamp: number;
  price?: number;
  title?: string;
  description?: string;
  metadata?: { strength?: number; confidence?: number; source?: string };
};

export type ChartSignalDetails = ChartSignal & {
  outcome?: { oneHour?: { status: string }; fourHour?: { status: string } };
};

export type Candle = { time: number; price: number };
export type ChartCandle = Candle;

export function signalRecordToChartSignal(record: {
  id: string;
  type: string;
  timestamp: string | number;
  score?: number;
  evidence?: Record<string, unknown>;
  outcome?: ChartSignalDetails["outcome"];
}): ChartSignalDetails | null {
  const type = record.type.toLowerCase();
  if (type !== "bullish" && type !== "bearish") return null;
  const parsedTimestamp = typeof record.timestamp === "string" ? Date.parse(record.timestamp) : record.timestamp;
  if (!Number.isFinite(parsedTimestamp) || parsedTimestamp <= 0) return null;
  const typeLabel = type === "bullish" ? "BULLISH" : "BEARISH";
  const evidencePrice = record.evidence?.price;
  const confidence = record.evidence?.confidence;
  return {
    id: record.id,
    type: typeLabel,
    timestamp: normalizeUnixSeconds(parsedTimestamp)!,
    ...(typeof evidencePrice === "number" && Number.isFinite(evidencePrice) && evidencePrice > 0 ? { price: evidencePrice } : {}),
    title: `${typeLabel.charAt(0)}${typeLabel.slice(1).toLowerCase()} signal`,
    description: typeof record.score === "number" ? `Signal engine score: ${Math.round(record.score)}/100.` : undefined,
    metadata: {
      ...(typeof record.score === "number" && Number.isFinite(record.score) ? { strength: record.score } : {}),
      ...(typeof confidence === "number" && Number.isFinite(confidence) ? { confidence } : {}),
    },
    outcome: record.outcome,
  };
}

export function normalizeUnixSeconds(timestamp: number): number | null {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  return Math.floor(timestamp >= 1e12 ? timestamp / 1000 : timestamp);
}

/**
 * Find the sample/candle interval containing a signal. The interval is
 * half-open: [this candle, next candle). The latest sample uses the previous
 * sample spacing as its expected live interval. Signals outside those bounds
 * are deliberately omitted instead of being snapped to an unrelated point.
 */
export function findSignalCandle(signalTimestamp: number, candles: Candle[]): Candle | null {
  const signalTime = normalizeUnixSeconds(signalTimestamp);
  if (signalTime === null || !candles.length) return null;

  const ordered = candles
    .map((candle) => ({ candle, time: normalizeUnixSeconds(candle.time) }))
    .filter((item): item is { candle: Candle; time: number } => item.time !== null)
    .sort((a, b) => a.time - b.time);
  if (!ordered.length) return null;

  const exact = ordered.find((item) => item.time === signalTime);
  if (exact) return exact.candle;

  for (let index = 0; index < ordered.length - 1; index++) {
    const current = ordered[index];
    const next = ordered[index + 1];
    if (signalTime >= current.time && signalTime < next.time) return current.candle;
  }

  const last = ordered[ordered.length - 1];
  if (signalTime > last.time && ordered.length > 1) {
    const interval = last.time - ordered[ordered.length - 2].time;
    if (interval > 0 && signalTime < last.time + interval) return last.candle;
  }
  return null;
}

export function buildSignalMarker(signal: ChartSignal, candles: Candle[]): SeriesMarker<UTCTimestamp> | null {
  const candle = findSignalCandle(signal.timestamp, candles);
  const time = candle && normalizeUnixSeconds(candle.time);
  if (time === null || time === undefined) return null;

  const strength = signal.metadata?.strength;
  const text = `${signal.type}${typeof strength === "number" && Number.isFinite(strength) ? ` ${Math.round(strength)}` : ""}`;
  const base = {
    id: signal.id,
    time: time as UTCTimestamp,
    color: signal.type === "BULLISH" ? "#4ade80" : "#fb7185",
    shape: signal.type === "BULLISH" ? "arrowUp" as const : "arrowDown" as const,
    text,
    size: 1.2,
  };

  if (typeof signal.price === "number" && Number.isFinite(signal.price) && signal.price > 0) {
    return { ...base, position: "atPriceMiddle", price: signal.price };
  }
  return { ...base, position: signal.type === "BULLISH" ? "belowBar" : "aboveBar" };
}
