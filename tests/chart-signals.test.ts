import { describe, expect, it } from "vitest";
import { buildSignalMarker, findSignalCandle, normalizeUnixSeconds, signalRecordToChartSignal, type ChartCandle, type ChartSignal } from "@/lib/market/chart-signals";

describe("chart signal time mapping", () => {
  const candles: ChartCandle[] = [
    { time: 1_791_015_000, price: 0.00014 },
    { time: 1_791_015_300, price: 0.00015 },
    { time: 1_791_015_600, price: 0.00016 },
  ];

  it("prefers an exact candle timestamp", () => {
    expect(findSignalCandle(1_791_015_300, candles)).toBe(candles[1]);
  });

  it("maps a signal to the candle interval containing it, not the nearest unrelated point", () => {
    expect(findSignalCandle(1_791_015_147, candles)).toBe(candles[0]);
    expect(findSignalCandle(1_791_015_347, candles)).toBe(candles[1]);
  });

  it("normalizes millisecond timestamps and preserves the containing interval", () => {
    expect(normalizeUnixSeconds(1_791_015_347_000)).toBe(1_791_015_347);
    expect(findSignalCandle(1_791_015_347_000, candles)).toBe(candles[1]);
  });

  it.each([60, 300, 900, 1_800, 3_600, 14_400, 86_400])("maps correctly with a %i-second candle interval", (interval) => {
    const sample = [
      { time: 1_791_000_000, price: 1 },
      { time: 1_791_000_000 + interval, price: 2 },
      { time: 1_791_000_000 + interval * 2, price: 3 },
    ];
    expect(findSignalCandle(1_791_000_000 + interval + 1, sample)).toBe(sample[1]);
  });

  it("returns null when a signal is outside loaded candle intervals", () => {
    expect(findSignalCandle(1_791_014_999, candles)).toBeNull();
    expect(findSignalCandle(1_791_015_901, candles)).toBeNull();
  });

  it("allows the latest candle's still-open interval, but rejects later unrelated times", () => {
    expect(findSignalCandle(1_791_015_899, candles)).toBe(candles[2]);
    expect(findSignalCandle(1_791_015_901, candles)).toBeNull();
  });

  it("anchors bullish and bearish markers at direction-aware positions and exact prices", () => {
    const bullish: ChartSignal = { id: "bull", type: "BULLISH", timestamp: 1_791_015_347, price: 0.000142, metadata: { strength: 87 } };
    const bearish: ChartSignal = { id: "bear", type: "BEARISH", timestamp: 1_791_015_347 };
    const bullMarker = buildSignalMarker(bullish, candles);
    const bearMarker = buildSignalMarker(bearish, candles);

    expect(bullMarker).toMatchObject({ id: "bull", time: candles[1].time, position: "atPriceMiddle", price: 0.000142, text: "BULLISH 87" });
    expect(bearMarker).toMatchObject({ id: "bear", time: candles[1].time, position: "aboveBar", shape: "arrowDown", text: "BEARISH" });
    expect(buildSignalMarker({ ...bullish, timestamp: 1_791_016_000 }, candles)).toBeNull();
  });

  it("normalizes signal-engine records and ignores non-directional signals", () => {
    expect(signalRecordToChartSignal({
      id: "from-api",
      type: "bearish",
      timestamp: "2026-10-03T10:32:27.000Z",
      score: 78,
      evidence: { price: 0.000158 },
    })).toMatchObject({
      id: "from-api",
      type: "BEARISH",
      timestamp: Date.parse("2026-10-03T10:32:27.000Z") / 1000,
      price: 0.000158,
      metadata: { strength: 78 },
    });
    expect(signalRecordToChartSignal({ id: "fade", type: "momentum_fade", timestamp: 1_791_015_347 })).toBeNull();
  });
});
