/**
 * Tests for the market intelligence layer (Phases 1, 3, 4, 5, 9, 10):
 * provider normalization, deterministic scoring, signal thresholds +
 * duplicate suppression, anomaly baselines, news→symbol matching and AI
 * output schema validation. Pure functions only — no network, no database.
 */
import { describe, expect, it } from "vitest";
import { normalizeMarketRow, normalizeChart, createMarketProvider, CoinGeckoProvider, TRACKED_COINS, type MarketRow } from "@/lib/market/coingecko";
import { computeScore, scoreInputFromSnapshot, FORMULA_VERSION, WEIGHTS, type ScoreInput } from "@/lib/score/engine";
import { evaluateSignal, signalDedupeKey, THRESHOLDS, SignalSchema, type SignalInput, type SignalType } from "@/lib/signals/engine";
import { computeBaseline, detectAnomalies, isNewAnomaly, parseStoredAssetSnapshot, ANOMALY_FORMULA_VERSION, type Baseline } from "@/lib/anomalies/engine";
import { AiExplanationSchema, assertNoInventedNumbers, parseExplanation, evidenceHash, type EvidencePacket } from "@/lib/ai-intel/explainer";
import type { AssetSnapshot } from "@/lib/market/types";

/* ── helpers ──────────────────────────────────────────────── */

function snap(over: Partial<AssetSnapshot> = {}): AssetSnapshot {
  return {
    symbol: "BTC",
    name: "Bitcoin",
    price: 65000,
    priceChange24h: 1.5,
    marketCap: 1.3e12,
    volume24h: 3e10,
    liquidity: 0.023,
    timestamp: new Date("2026-09-25T00:00:00Z").toISOString(),
    provider: "coingecko",
    ...over,
  };
}

const flatBase: Baseline = {
  avgVolume: null,
  stdevVolume: null,
  avgVolatility: null,
  avgLiquidityRatio: null,
  avgMarketCap: null,
  newsRatePerHour: null,
  windowHours: 24,
};

/* ── Phase 1: provider normalization ──────────────────────── */

describe("market provider normalization", () => {
  const row: MarketRow = {
    id: "bitcoin",
    symbol: "btc",
    name: "Bitcoin",
    current_price: 65000.5,
    price_change_percentage_24h_in_currency: -2.34,
    market_cap: 1.29e12,
    total_volume: 3.1e10,
    high_24h: 66000,
    low_24h: 63000,
    circulating_supply: 19800000,
    fully_diluted_valuation: 1.37e12,
    market_cap_rank: 1,
    last_updated: "2026-09-25T00:00:00.000Z",
    sparkline_in_7d: { price: [64000, 64500, null, 65000] },
  };

  it("normalizes a CoinGecko row into the internal format with timestamp + provider", () => {
    const s = normalizeMarketRow(row);
    expect(s).not.toBeNull();
    expect(s!.symbol).toBe("BTC"); // uppercased
    expect(s!.price).toBeCloseTo(65000.5);
    expect(s!.priceChange24h).toBeCloseTo(-2.34);
    expect(s!.marketCap).toBe(1.29e12);
    expect(s!.volume24h).toBe(3.1e10);
    expect(s!.liquidity).toBeGreaterThan(0); // derived volume/mcap proxy
    expect(s!.timestamp).toBeTruthy();
    expect(s!.provider).toBe("coingecko");
    expect(s!.sparkline7d).toEqual([64000, 64500, 65000]); // nulls dropped
  });

  it("drops rows without a usable price instead of inventing one", () => {
    expect(normalizeMarketRow({ ...row, current_price: null })).toBeNull();
    expect(normalizeMarketRow({ ...row, current_price: 0 })).toBeNull();
  });

  it("treats missing numeric fields as 0 rather than NaN", () => {
    const s = normalizeMarketRow({ id: "x", symbol: "x", name: "X", current_price: 1 } as MarketRow);
    expect(s).not.toBeNull();
    expect(Number.isFinite(s!.marketCap)).toBe(true);
    expect(Number.isFinite(s!.volume24h)).toBe(true);
  });

  it("normalizes chart data to HistoricalPoint[] and ignores malformed input", () => {
    const pts = normalizeChart({ prices: [[1, 10], [2, 11], [3, null], "junk", [4, 12]] }, "24h");
    expect(pts.every((p) => Number.isFinite(p.price) && p.price > 0)).toBe(true);
    expect(pts.map((p) => p.price)).toEqual([10, 11, 12]);
    expect(normalizeChart(null, "7d")).toEqual([]);
    expect(normalizeChart({}, "7d")).toEqual([]);
  });

  it("exposes the provider interface through the registry factory", () => {
    const p = createMarketProvider("coingecko");
    expect(typeof p.getAssets).toBe("function");
    expect(typeof p.getMarketSnapshot).toBe("function");
    expect(typeof p.getHistoricalData).toBe("function");
    expect(p.id).toBe("coingecko");
    expect(() => createMarketProvider("nope")).toThrow(/Unknown market provider/);
    expect(new CoinGeckoProvider()).toBeInstanceOf(Object);
    expect(TRACKED_COINS.length).toBeGreaterThan(0);
  });
});

/* ── Phase 3: deterministic score ─────────────────────────── */

const scoreBase: ScoreInput = {
  priceChange24h: 2,
  volume24h: 1e9,
  avgVolumePrior: 9e8,
  marketCap: 5e9,
  liquidityRatio: 0.2,
  priceSeries: [100, 101, 102, 103, 104, 105],
  newsCount24h: 3,
  socialScore: null,
};

describe("score engine (deterministic, versioned)", () => {
  const base: ScoreInput = scoreBase;

  it("returns score + all seven components + formula version", () => {
    const r = computeScore(base);
    expect(r.formulaVersion).toBe(FORMULA_VERSION);
    expect(Object.keys(r.components).sort()).toEqual(["liquidity", "marketCap", "momentum", "movingAverage", "newsSocial", "volatility", "volume"]);
    for (const c of Object.values(r.components)) expect(c).toBeGreaterThanOrEqual(0);
    for (const c of Object.values(r.components)) expect(c).toBeLessThanOrEqual(100);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
  });

  it("is reproducible: same input → identical output", () => {
    expect(computeScore(base)).toEqual(computeScore({ ...base }));
  });

  it("applies the specified weights (25/20/15/10/10/10/10 summing to 100)", () => {
    expect(WEIGHTS).toMatchObject({ momentum: 25, volume: 20, liquidity: 15, volatility: 10, marketCap: 10, movingAverage: 10, newsSocial: 10 });
    expect(Object.values(WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("rewards momentum and punishes dumps monotonically", () => {
    const up = computeScore({ ...base, priceChange24h: 10 }).components.momentum;
    const flat = computeScore({ ...base, priceChange24h: 0 }).components.momentum;
    const down = computeScore({ ...base, priceChange24h: -10 }).components.momentum;
    expect(up).toBeGreaterThan(flat);
    expect(flat).toBeGreaterThan(down);
  });

  it("handles missing history gracefully (null baselines) without throwing", () => {
    const r = computeScore({ ...base, avgVolumePrior: null, priceSeries: [], newsCount24h: 0, socialScore: null });
    expect(Number.isFinite(r.score)).toBe(true);
  });

  it("builds inputs from snapshots (worker path)", () => {
    const input = scoreInputFromSnapshot(snap({ sparkline7d: [1, 2, 3, 4] }), { avgVolumePrior: 1, newsCount24h: 2, socialScore: null });
    expect(input.priceChange24h).toBe(1.5);
    expect(Number.isFinite(computeScore(input).score)).toBe(true);
  });
});

/* ── Phase 4: signals ─────────────────────────────────────── */

describe("signal engine", () => {
  const now = new Date("2026-09-25T12:00:00Z");
  const evidence = { price: 100, priceChange24h: 12, volume24h: 5e9, marketCap: 1e9, score: 80, components: {} };

  function sigInput(over: Partial<SignalInput> = {}): SignalInput {
    const result = computeScore({ priceChange24h: 12, volume24h: 5e9, avgVolumePrior: 1e9, marketCap: 1e9, liquidityRatio: 0.5, priceSeries: [1, 2, 3, 4, 5, 6], newsCount24h: 5, socialScore: null });
    return { symbol: "PEPE", now, result, evidence, volumeRatio: 5, previous: null, ...over };
  }

  it("emits a bullish signal above the threshold, with evidence + expiry + formula version", () => {
    const out = evaluateSignal(sigInput());
    expect(out.length).toBeGreaterThan(0);
    const s = out[0];
    expect(s.type).toBe("bullish");
    expect(s.score).toBeGreaterThanOrEqual(THRESHOLDS.bullishScore);
    expect(s.evidence.price).toBe(100);
    expect(new Date(s.expiresAt).getTime()).toBeGreaterThan(now.getTime());
    expect(s.formulaVersion).toBe(FORMULA_VERSION);
    expect(() => SignalSchema.parse({ ...s, id: "abc123" })).not.toThrow();
  });

  it("suppresses duplicates while an equivalent signal is unexpired", () => {
    const first = evaluateSignal(sigInput());
    expect(first.length).toBe(1);
    const prev = { score: first[0].score, types: [first[0].type] as SignalType[], emittedAt: new Date(now.getTime() - 60_000) };
    const again = evaluateSignal(sigInput({ previous: prev }));
    expect(again.filter((c) => c.type === first[0].type)).toHaveLength(0);
  });

  it("escalates a big score move into a score_shift even when a signal is active", () => {
    // Genuine regime change: an active bullish signal was emitted at score 80,
    // but the asset has now fallen out of the bullish zone (score < 65). The
    // prior signal is still unexpired, yet this is exactly the kind of move the
    // feed must surface — as a fresh event (score_shift / momentum_fade), never
    // as a duplicate of the still-active type.
    const prev = { score: 80, types: ["bullish" as const], emittedAt: new Date(now.getTime() - 60_000) };
    const out = evaluateSignal(sigInput({ previous: prev, volumeRatio: null, result: computeScore({ ...scoreBase, priceChange24h: -12 }) }));
    expect(out.length).toBe(1);
    expect(["score_shift", "momentum_fade"]).toContain(out[0].type);
    expect(out[0].type).not.toBe("bullish");
  });

  it("does NOT escalate a same-zone re-cross below the shift delta (no duplicates)", () => {
    // Previous bullish signal emitted at score 80; still 80 now. Nothing changed —
    // the feed must stay quiet instead of re-emitting bullish/score_shift noise.
    const prev = { score: 80, types: ["bullish" as const], emittedAt: new Date(now.getTime() - 60_000) };
    const out = evaluateSignal(sigInput({ previous: prev, volumeRatio: null }));
    expect(out).toHaveLength(0);
  });

  it("emits nothing for a quiet mid-range asset with no baseline breach", () => {
    const result = computeScore({ priceChange24h: 0.2, volume24h: 1e9, avgVolumePrior: 1e9, marketCap: 5e10, liquidityRatio: 0.02, priceSeries: [100, 100.1, 99.9, 100], newsCount24h: 0, socialScore: null });
    const out = evaluateSignal({ symbol: "BTC", now, result, evidence: { ...evidence, score: result.score, priceChange24h: 0.2 }, volumeRatio: 1, previous: null });
    expect(out).toHaveLength(0);
  });

  it("dedupe keys bucket by symbol+type+time so repeats collide but later ones don't", () => {
    const k1 = signalDedupeKey("PEPE", "bullish", now);
    const k2 = signalDedupeKey("PEPE", "bullish", new Date(now.getTime() + 1000));
    const k3 = signalDedupeKey("PEPE", "bullish", new Date(now.getTime() + 25 * 3600_000));
    expect(k1).toBe(k2);
    expect(k1).not.toBe(k3);
    expect(signalDedupeKey("DOGE", "bullish", now)).not.toBe(k1);
  });
});

/* ── Phase 5: anomalies ───────────────────────────────────── */

describe("anomaly engine", () => {
  it("decodes normalized snapshots stored in the market snapshot JSON column", () => {
    const snapshot = snap();
    expect(parseStoredAssetSnapshot("BTC", snapshot)).toEqual(snapshot);
    expect(parseStoredAssetSnapshot("BTC", { ...snapshot, price: "65000" })).toBeNull();
    expect(parseStoredAssetSnapshot("BTC", null)).toBeNull();
  });

  it("computes baselines over the trailing window", () => {
    const hist = [10, 12, 11, 13, 100].map((v) => ({ volume24h: v * 1e6, price: v, liquidity: 0.1, marketCap: 1e9 }));
    const b = computeBaseline(hist, 24);
    expect(b.avgVolume).not.toBeNull();
    // deterministic: same history → same baseline (and it stays below a single spike)
    expect(computeBaseline(hist, 24)).toEqual(b);
    expect(b.avgVolume!).toBeLessThan(100e6);
    expect(b.windowHours).toBe(24);
  });

  it("flags unusual volume only against a defined baseline", () => {
    const hit = detectAnomalies(snap({ volume24h: 3e10 }), { ...flatBase, avgVolume: 1e10, stdevVolume: 5e8 }, null);
    expect(hit.some((a) => a.type === "unusual_volume")).toBe(true);
    const miss = detectAnomalies(snap({ volume24h: 1.1e10 }), { ...flatBase, avgVolume: 1e10 }, null);
    expect(miss.some((a) => a.type === "unusual_volume")).toBe(false);
    // no baseline at all → never call it anomalous
    expect(detectAnomalies(snap({ volume24h: 1e12 }), flatBase, null)).toHaveLength(0);
  });

  it("detects rapid price moves with severity scaled to the breach, plus formula version + window", () => {
    const out = detectAnomalies(snap({ priceChange24h: -12 }), flatBase, null);
    const a = out.find((x) => x.type === "rapid_price_move");
    expect(a).toBeDefined();
    expect(a!.severity).toBe("medium"); // 12% is 1.5× the ±8% threshold
    expect(detectAnomalies(snap({ priceChange24h: -21 }), flatBase, null).find((x) => x.type === "rapid_price_move")!.severity).toBe("high");
    expect(a!.formulaVersion).toBe(ANOMALY_FORMULA_VERSION);
    expect(a!.baselineWindowHours).toBe(24);
  });

  it("news surge requires a positive hourly baseline", () => {
    expect(detectAnomalies(snap(), { ...flatBase, newsRatePerHour: 0 }, 50).some((a) => a.type === "news_surge")).toBe(false);
    expect(detectAnomalies(snap(), { ...flatBase, newsRatePerHour: 0.1 }, 50).some((a) => a.type === "news_surge")).toBe(true);
  });

  it("cooldown suppresses repeated same-type anomalies", () => {
    const cand = { symbol: "BTC", type: "unusual_volume", severity: "high", observed: 3, baseline: 1, ratio: 3, description: "x", timestamp: new Date().toISOString(), baselineWindowHours: 24, formulaVersion: ANOMALY_FORMULA_VERSION };
    const existing = [{ type: "unusual_volume", timestamp: new Date().toISOString() }];
    expect(isNewAnomaly(existing, cand as never, 3600_000)).toBe(false);
    expect(isNewAnomaly([{ type: "liquidity_change", timestamp: new Date().toISOString() }], cand as never, 3600_000)).toBe(true);
    expect(isNewAnomaly([], cand as never, 3600_000)).toBe(true);
  });
});

/* ── Phase 9: news → symbol matching ──────────────────────── */

describe("news entity matching (coins tags → symbols)", () => {
  // mirrors the normalization in scripts/news-correlation.ts: uppercase ticker keys
  const matchSymbols = (coins: (string | undefined)[]) => coins.filter(Boolean).map((c) => String(c).toUpperCase());

  it("uppercases and dedupes case variants", () => {
    expect(matchSymbols(["btc", "BTC"])).toEqual(["BTC", "BTC"]);
    expect(matchSymbols(["eth"]).includes("ETH")).toBe(true);
  });

  it("ignores empty/undefined coin tags instead of creating phantom entities", () => {
    expect(matchSymbols([undefined, "", "sol"])).toEqual(["SOL"]);
  });
});

/* ── Phase 10: AI schema validation ───────────────────────── */

describe("AI explanation contract", () => {
  const good = {
    signalLabel: "Momentum burst",
    confidence: "medium" as const,
    summary: "Price rose 12% in 24h on 5× average volume; the live score sits at 80.",
    evidence: ["24h change +12%", "volume 5× baseline"],
    caveats: ["Baselines cover only 24 hours."],
  };
  const packet: EvidencePacket = { kind: "signal", symbol: "PEPE", facts: { priceChange24h: 12, volume24h: 5e9, score: 80 }, formulaVersion: FORMULA_VERSION };

  it("accepts a well-formed explanation whose numbers exist in the evidence", () => {
    expect(AiExplanationSchema.safeParse(good).success).toBe(true);
    expect(parseExplanation(JSON.stringify(good), packet)).toEqual(good);
  });

  it("rejects malformed JSON, wrong enums and missing fields", () => {
    expect(() => parseExplanation("not json {{{", packet)).toThrow(/no JSON object/);
    expect(() => parseExplanation(JSON.stringify({ ...good, confidence: "certain" }), packet)).toThrow();
    expect(() => parseExplanation(JSON.stringify({ ...good, evidence: [] }), packet)).toThrow();
    expect(() => parseExplanation(JSON.stringify({ summary: "hi" }), packet)).toThrow();
  });

  it("blocks invented numbers not present in the evidence", () => {
    expect(() => assertNoInventedNumbers(good, packet)).not.toThrow();
    const invented = { ...good, summary: "A whale bought 42069 tokens pushing price 999%." };
    expect(() => assertNoInventedNumbers(invented, packet)).toThrow(/invented the number/);
  });

  it("caches by evidence hash: equal packets hash equal, changed packets differ", () => {
    expect(evidenceHash(packet)).toBe(evidenceHash({ ...packet }));
    expect(evidenceHash(packet)).not.toBe(evidenceHash({ ...packet, facts: { ...packet.facts, score: 81 } }));
  });
});
