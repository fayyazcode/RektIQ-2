/**
 * Phase 6 — Realtime protocol (TDD red).
 * Pure, deterministic checks for the Socket.IO contract so we can green
 * without a live server or DB. No network, no mocks of the provider.
 */
import { describe, expect, it } from "vitest";

// These imports must fail until Phase 6 ships — that's the RED we want.
import { SYMBOL_RE, isValidSymbol, REALTIME_EVENTS, isMarketUpdate, isSystemStatus } from "@/lib/realtime/protocol";
import { resolveRealtimeUrl } from "@/lib/realtime/url";

describe("realtime protocol", () => {
  it("validates symbols with SYMBOL_RE (uppercase alnum + $ - . up to 20)", () => {
    expect(SYMBOL_RE.test("BTC")).toBe(true);
    expect(SYMBOL_RE.test("PEPE")).toBe(true);
    expect(SYMBOL_RE.test("WIF")).toBe(true);
    expect(SYMBOL_RE.test("BONK")).toBe(true);
    expect(isValidSymbol("btc")).toBe(true); // case-insensitive helper
    expect(isValidSymbol("a-b.c$1")).toBe(true);
    expect(isValidSymbol("")).toBe(false);
    expect(isValidSymbol("has space")).toBe(false);
    expect(isValidSymbol("toolongtoolongtoolong")).toBe(false);
    expect(isValidSymbol("btc; DROP")).toBe(false);
  });

  it("exposes the canonical event and room names", () => {
    expect(REALTIME_EVENTS.MARKET_UPDATE).toBe("market:update");
    expect(REALTIME_EVENTS.SIGNAL_NEW).toBe("signal:new");
    expect(REALTIME_EVENTS.ANOMALY_NEW).toBe("anomaly:new");
    expect(REALTIME_EVENTS.SYSTEM_STATUS).toBe("system:status");
    expect(REALTIME_EVENTS.ASSET_SCORE).toBe("asset:score");
    expect(REALTIME_EVENTS.SUBSCRIBE_ASSET).toBe("subscribe:asset");
    expect(REALTIME_EVENTS.UNSUBSCRIBE_ASSET).toBe("unsubscribe:asset");
    expect(REALTIME_EVENTS.JOIN_MEMECOINS).toBe("join:memecoins");
  });

  it("validates market:update batches carry timestamp + provider + stale flag", () => {
    const good = {
      assets: [{ symbol: "BTC", name: "Bitcoin", price: 65000, priceChange24h: 1.5, marketCap: 1e12, volume24h: 3e10, liquidity: 0.03, timestamp: new Date().toISOString(), provider: "coingecko" }],
      fetchedAt: new Date().toISOString(),
      provider: "coingecko",
      stale: false,
    };
    expect(isMarketUpdate(good)).toBe(true);
    expect(isMarketUpdate({ ...good, stale: true, error: "rate limited" })).toBe(true);
    expect(isMarketUpdate({ ...good, provider: "" })).toBe(false);
    expect(isMarketUpdate({ ...good, fetchedAt: "not-iso" })).toBe(false);
    expect(isMarketUpdate({ assets: [], fetchedAt: good.fetchedAt, provider: "coingecko", stale: false })).toBe(true);
  });

  it("validates system:status carries stale + tickMs and never leaks secrets", () => {
    const ok = { connected: true, serverTime: new Date().toISOString(), stale: false, tickMs: 60_000 };
    expect(isSystemStatus(ok)).toBe(true);
    const withSecret = { ...ok, token: "should-not-be-here" } as unknown as typeof ok;
    // payload must not be considered valid if it carries secret-like keys
    expect(isSystemStatus(withSecret)).toBe(false);
    expect(isSystemStatus({ ...ok, tickMs: -1 })).toBe(false);
  });

  it("resolves the realtime URL from NEXT_PUBLIC_REALTIME_URL with fallback to REALTIME_URL", () => {
    expect(resolveRealtimeUrl({ NEXT_PUBLIC_REALTIME_URL: "https://rt.example.com", REALTIME_URL: "https://fallback.example.com" })).toBe("https://rt.example.com");
    expect(resolveRealtimeUrl({ REALTIME_URL: "https://fallback.example.com" })).toBe("https://fallback.example.com");
    expect(resolveRealtimeUrl({})).toBeUndefined();
    // trims and drops empty
    expect(resolveRealtimeUrl({ NEXT_PUBLIC_REALTIME_URL: "  " })).toBeUndefined();
  });
});
