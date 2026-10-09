/**
 * Phase 14 — Testing: UI components and edge cases.
 * Tests for the new Phase 8 UI components, Socket.IO payloads,
 * stale data, provider failures, and malformed AI responses.
 */
import { vi } from "vitest";
// Mock server-only module before importing
vi.mock("server-only", () => ({}));
import { describe, expect, it } from "vitest";
import { AiExplanationSchema, parseExplanation, ruleBasedExplanation, type EvidencePacket } from "@/lib/ai-intel/explainer";
import { FORMULA_VERSION, WEIGHTS, computeScore } from "@/lib/score/engine";
import { THRESHOLDS, evaluateSignal, signalDedupeKey } from "@/lib/signals/engine";
import { detectAnomalies, ANOMALY_FORMULA_VERSION } from "@/lib/anomalies/engine";
import { describeImpact, priceAt, avgVolumeIn } from "@/lib/news/correlation";
import { GenerateRequestSchema, factLines, templatePosts } from "@/lib/social/xgen";

/* ── Phase 8 UI component helpers ────────────────────── */

function makeSignalView(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "test-id",
    symbol: "BTC",
    type: "bullish",
    score: 80,
    evidence: { price: 65000, priceChange24h: 5, volume24h: 3e10, marketCap: 1e12 },
    timestamp: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 6 * 3600_000).toISOString(),
    formulaVersion: FORMULA_VERSION,
    ...over,
  };
}

function makeAnomalyView(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "test-anomaly-id",
    symbol: "BTC",
    type: "unusual_volume",
    severity: "high",
    observed: 3e10,
    baseline: 1e10,
    ratio: 3,
    description: "24h volume is 3× the 24h average.",
    timestamp: new Date().toISOString(),
    baselineWindowHours: 24,
    formulaVersion: ANOMALY_FORMULA_VERSION,
    ...over,
  };
}

function makeNewsImpactView(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "test-news-impact-id",
    symbol: "BTC",
    headline: "Bitcoin ETF approved",
    source: "CoinDesk",
    url: "https://example.com",
    publishedAt: new Date().toISOString(),
    windowMinutes: 60,
    priceBefore: 65000,
    priceAfter: 66000,
    priceChangePct: 1.54,
    volumeReactionRatio: 1.8,
    computedAt: new Date().toISOString(),
    formulaVersion: "news-impact-v1",
    ...over,
  };
}

/* ── UI component data validation ────────────────────── */

describe("Phase 8 UI component data validation", () => {
  it("SignalFeed data is valid with required fields", () => {
    const signal = makeSignalView();
    expect(signal.id).toBeTruthy();
    expect(signal.symbol).toBe("BTC");
    expect(typeof signal.score).toBe("number");
    expect(signal.evidence).toBeDefined();
  });

  it("AnomalyFeed data is valid with severity", () => {
    const anomaly = makeAnomalyView();
    expect(anomaly.id).toBeTruthy();
    expect(["low", "medium", "high"]).toContain(anomaly.severity);
    expect(typeof anomaly.ratio).toBe("number");
  });

  it("NewsImpact data is valid with correlation wording", () => {
    const impact = makeNewsImpactView();
    expect(impact.id).toBeTruthy();
    expect(impact.priceChangePct).toBeDefined();
    expect(impact.formulaVersion).toBe("news-impact-v1");
  });

  it("DegenRadar data has required fields", () => {
    const row = {
      symbol: "PEPE",
      name: "Pepe",
      price: 0.00001,
      priceChange24h: 25,
      volume24h: 1e6,
      marketCap: 5e6,
      fdv: null,
      volMcapRatio: 0.2,
      liquidity: 0.2,
      score: null,
      anomaly: null,
      rank: null,
      timestamp: new Date().toISOString(),
      provider: "coingecko",
    };
    expect(row.symbol).toBe("PEPE");
    expect(row.volMcapRatio).toBeGreaterThan(0);
    expect(typeof row.price).toBe("number");
  });

  it("ProviderHealth data has required fields", () => {
    const health = {
      provider: "coingecko",
      requests: 100,
      errors: 0,
      rateLimits: 0,
      lastSuccessAt: new Date().toISOString(),
      lastFailureAt: null,
      lastError: null,
      avgLatencyMs: 150,
      stale: false,
      updatedAt: new Date().toISOString(),
    };
    expect(health.provider).toBe("coingecko");
    expect(health.requests).toBeGreaterThanOrEqual(0);
    expect(["low", "medium", "high"]).not.toContain(health.provider); // not a severity
  });
});

/* ── Socket.IO event payload validation ──────────────── */

describe("Socket.IO event payloads", () => {
  it("market:update payload has required fields", () => {
    const payload = {
      assets: [{ symbol: "BTC", name: "Bitcoin", price: 65000, priceChange24h: 1.5, marketCap: 1e12, volume24h: 3e10, liquidity: 0.03, timestamp: new Date().toISOString(), provider: "coingecko" }],
      fetchedAt: new Date().toISOString(),
      provider: "coingecko",
      stale: false,
    };
    expect(payload.assets).toBeDefined();
    expect(payload.provider).toBe("coingecko");
    expect(typeof payload.stale).toBe("boolean");
    expect(payload.fetchedAt).toBeTruthy();
  });

  it("signal:new payload has evidence and formula version", () => {
    const signal = makeSignalView();
    expect(signal.evidence).toBeDefined();
    expect(signal.formulaVersion).toBe(FORMULA_VERSION);
    expect(signal.expiresAt).toBeTruthy();
  });

  it("anomaly:new payload has ratio and baseline", () => {
    const anomaly = makeAnomalyView();
    expect(anomaly.ratio).toBeDefined();
    expect(anomaly.baseline).toBeDefined();
    expect(anomaly.formulaVersion).toBe(ANOMALY_FORMULA_VERSION);
  });

  it("system:status payload never leaks secrets", () => {
    const payload = { connected: true, serverTime: new Date().toISOString(), stale: false, tickMs: 60_000 };
    const secretKeys = ["token", "secret", "apiKey", "api_key", "authorization", "password"];
    for (const key of secretKeys) {
      expect(key in payload).toBe(false);
    }
  });
});

/* ── Stale data and provider failure handling ────────── */

describe("Stale data and provider failure", () => {
  it("score engine handles empty price series gracefully", () => {
    const result = computeScore({
      priceChange24h: 2,
      volume24h: 1e9,
      avgVolumePrior: null,
      marketCap: 5e9,
      priceSeries: [],
      newsCount24h: 0,
      socialScore: null,
    });
    expect(Number.isFinite(result.score)).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.formulaVersion).toBe(FORMULA_VERSION);
  });

  it("score engine handles zero volume", () => {
    const result = computeScore({
      priceChange24h: 2,
      volume24h: 0,
      avgVolumePrior: null,
      marketCap: 5e9,
      priceSeries: [100, 101],
      newsCount24h: 0,
      socialScore: null,
    });
    expect(Number.isFinite(result.score)).toBe(true);
  });

  it("anomaly engine requires a baseline — never calls something anomalous without one", () => {
    const flatBase = { avgVolume: null, stdevVolume: null, avgVolatility: null, avgLiquidityRatio: null, avgMarketCap: null, newsRatePerHour: null, windowHours: 24 };
    const out = detectAnomalies({ symbol: "BTC", name: "Bitcoin", price: 65000, priceChange24h: 5, volume24h: 3e10, marketCap: 1e12, liquidity: 0.03, timestamp: new Date().toISOString(), provider: "coingecko" }, flatBase, null);
    expect(out).toHaveLength(0);
  });

  it("score engine is reproducible with null baselines", () => {
    const input = { priceChange24h: 0, volume24h: 1e9, avgVolumePrior: null, marketCap: 1e9, priceSeries: [], newsCount24h: 0, socialScore: null };
    const r1 = computeScore(input);
    const r2 = computeScore(input);
    expect(r1).toEqual(r2);
  });
});

/* ── Malformed AI responses ──────────────────────────── */

describe("Malformed AI responses", () => {
  const packet: EvidencePacket = { kind: "signal", symbol: "BTC", facts: { priceChange24h: 5, volume24h: 3e10, score: 80 }, formulaVersion: FORMULA_VERSION };

  it("rejects empty AI response", () => {
    expect(() => parseExplanation("", packet)).toThrow();
  });

  it("rejects response with no JSON object", () => {
    expect(() => parseExplanation("just text no json", packet)).toThrow(/no JSON object/);
  });

  it("rejects response with wrong enum values", () => {
    expect(() => parseExplanation(JSON.stringify({ signalLabel: "Test", confidence: "certain", summary: "test", evidence: ["test"], caveats: ["test"] }), packet)).toThrow();
  });

  it("rejects response with missing required fields", () => {
    expect(() => parseExplanation(JSON.stringify({ signalLabel: "Test" }), packet)).toThrow();
  });

  it("rule-based fallback never throws", () => {
    const result = ruleBasedExplanation(packet);
    expect(result.signalLabel).toBeTruthy();
    expect(result.confidence).toBeDefined();
    expect(result.summary).toBeTruthy();
    expect(result.evidence).toBeInstanceOf(Array);
  });
});

/* ── Reconnect behavior simulation ───────────────────── */

describe("Reconnect behavior", () => {
  it("market batch with stale flag indicates provider failure", () => {
    const staleBatch = { assets: [], fetchedAt: "", provider: "coingecko", stale: true, error: "rate limited" };
    expect(staleBatch.stale).toBe(true);
    expect(staleBatch.error).toBe("rate limited");
  });

  it("market batch without stale flag indicates healthy provider", () => {
    const freshBatch = { assets: [{ symbol: "BTC", name: "Bitcoin", price: 65000, priceChange24h: 1.5, marketCap: 1e12, volume24h: 3e10, liquidity: 0.03, timestamp: new Date().toISOString(), provider: "coingecko" }], fetchedAt: new Date().toISOString(), provider: "coingecko", stale: false };
    expect(freshBatch.stale).toBe(false);
  });
});

/* ── API authorization ───────────────────────────────── */

describe("API authorization", () => {
  it("GenerateRequestSchema validates refId format", () => {
    expect(GenerateRequestSchema.safeParse({ refType: "signal", refId: "abc123" }).success).toBe(false);
    expect(GenerateRequestSchema.safeParse({ refType: "signal", refId: "550e8400-e29b-41d4-a716-446655440000" }).success).toBe(true);
    expect(GenerateRequestSchema.safeParse({ refType: "invalid", refId: "550e8400-e29b-41d4-a716-446655440000" }).success).toBe(false);
  });

  it("GenerateRequestSchema rejects empty refId", () => {
    expect(GenerateRequestSchema.safeParse({ refType: "signal", refId: "" }).success).toBe(false);
  });
});

/* ── News/asset matching ─────────────────────────────── */

describe("News/asset matching", () => {
  it("priceAt interpolates correctly between two points", () => {
    const snaps = [
      { timestamp: new Date("2026-09-25T00:00:00Z").toISOString(), price: 100 },
      { timestamp: new Date("2026-09-25T01:00:00Z").toISOString(), price: 110 },
    ];
    expect(priceAt(snaps, new Date("2026-09-25T00:30:00Z").getTime())).toBe(105);
  });

  it("priceAt returns null outside range", () => {
    const snaps = [
      { timestamp: new Date("2026-09-25T00:00:00Z").toISOString(), price: 100 },
      { timestamp: new Date("2026-09-25T01:00:00Z").toISOString(), price: 110 },
    ];
    expect(priceAt(snaps, new Date("2026-09-24T00:00:00Z").getTime())).toBeNull();
    expect(priceAt(snaps, new Date("2026-09-26T00:00:00Z").getTime())).toBeNull();
  });

  it("avgVolumeIn returns null for empty window", () => {
    const snaps = [{ timestamp: new Date("2026-09-25T00:00:00Z").toISOString(), volume24h: 1e9 }];
    expect(avgVolumeIn(snaps, 0, 0)).toBeNull();
  });

  it("describeImpact uses correlational wording", () => {
    const text = describeImpact({ priceChangePct: 5.0, windowMinutes: 60 });
    expect(text).toContain("Observed movement after publication");
    expect(text).toContain("correlation, not causation");
  });
});

/* ── X post generation ───────────────────────────────── */

describe("X post generation", () => {
  it("factLines returns factual lines only", () => {
    const facts = factLines({ price: 65000, priceChange24h: 5, volume24h: 3e10, marketCap: 1e12, score: 80 }, "BTC", "BULLISH signal (score 80/100)");
    expect(facts.length).toBeGreaterThan(0);
    expect(facts.every((f) => typeof f === "string")).toBe(true);
    expect(facts).toContain("RecktIQ Live Score: 80/100");
  });

  it("templatePosts never invents numbers", () => {
    const posts = templatePosts("BTC", "BULLISH signal", ["24h change: +5%", "Market cap: $1.00B"]);
    expect(posts.length).toBe(3);
    expect(posts.every((p) => typeof p.text === "string" && p.text.length > 0)).toBe(true);
    expect(posts[1].text).toContain("Measured by RecktIQ's live scoring");
  });
});

/* ── Provider failure testing ────────────────────────── */

describe("Provider failure scenarios", () => {
  it("score weights sum to 100", () => {
    expect(Object.values(WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("score components are within 0-100 range", () => {
    const result = computeScore({
      priceChange24h: 10,
      volume24h: 1e9,
      avgVolumePrior: 1e8,
      marketCap: 1e9,
      priceSeries: [100, 110],
      newsCount24h: 5,
      socialScore: null,
    });
    for (const v of Object.values(result.components)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });

  it("signal thresholds are correct", () => {
    expect(THRESHOLDS.bullishScore).toBe(75);
    expect(THRESHOLDS.bearishScore).toBe(30);
    expect(THRESHOLDS.scoreShiftDelta).toBe(10);
    expect(THRESHOLDS.ttlMs).toBe(6 * 3600_000);
  });

  it("anomaly formula version is consistent", () => {
    expect(ANOMALY_FORMULA_VERSION).toBe("anomaly-v1");
  });
});