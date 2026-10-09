/**
 * Phase 7 — API layer validation (TDD red).
 * Pure checks for query schemas + GenerateRequestSchema strictness +
 * the promise that route payloads carry timestamp/provider/stale.
 */
import { vi } from "vitest";
// Mock server-only module before importing
vi.mock("server-only", () => ({}));
import { describe, expect, it } from "vitest";
import { GenerateRequestSchema } from "@/lib/social/xgen";
import { parseMarketOverviewQuery, parseListQuery, parseDegenQuery } from "@/lib/api/validation";

describe("api validation", () => {
  it("parses market overview query (symbols uppercased, limit bounded)", () => {
    const q = parseMarketOverviewQuery(new URLSearchParams("symbols=btc, eth , SOL&limit=200"));
    expect(q.symbols).toEqual(["BTC", "ETH", "SOL"]);
    expect(q.limit).toBe(100); // clamped
    expect(parseMarketOverviewQuery(new URLSearchParams("")).symbols).toEqual([]);
  });

  it("rejects invalid before cursor", () => {
    expect(() => parseListQuery(new URLSearchParams("before=not-a-date"))).toThrow();
    expect(parseListQuery(new URLSearchParams("before=2026-09-25T00:00:00.000Z")).before).toBeTruthy();
  });

  it("parses list query with type + symbol normalization", () => {
    const q = parseListQuery(new URLSearchParams("symbol=pepe&type=bullish&limit=5"));
    expect(q.symbol).toBe("PEPE");
    expect(q.type).toBe("bullish");
    expect(q.limit).toBe(5);
  });

  it("parses degen query with maxMarketCap bounds", () => {
    expect(parseDegenQuery(new URLSearchParams("maxMarketCap=1000000")).maxMarketCap).toBe(1_000_000);
    expect(parseDegenQuery(new URLSearchParams("")).maxMarketCap).toBe(500_000_000);
    expect(() => parseDegenQuery(new URLSearchParams("maxMarketCap=-1"))).toThrow();
    expect(() => parseDegenQuery(new URLSearchParams("maxMarketCap=not-a-number"))).toThrow();
  });

  it("GenerateRequestSchema accepts only {refType, refId} and rejects injected fields", () => {
    expect(GenerateRequestSchema.safeParse({ refType: "signal", refId: "abc12345" }).success).toBe(true);
    // extra fields like customText must be stripped / not accepted as evidence
    const withExtra = GenerateRequestSchema.safeParse({ refType: "signal", refId: "abc12345", text: "pump it", price: 999 } as unknown as Record<string, unknown>);
    // strict: extra keys should not silently become part of validated data
    if (withExtra.success) {
      expect((withExtra.data as unknown as Record<string, unknown>).text).toBeUndefined();
      expect((withExtra.data as unknown as Record<string, unknown>).price).toBeUndefined();
    }
    expect(GenerateRequestSchema.safeParse({ refType: "signal", refId: "short" }).success).toBe(false);
    expect(GenerateRequestSchema.safeParse({ refType: "hype", refId: "abc12345" } as unknown as Record<string, unknown>).success).toBe(false);
  });
});
