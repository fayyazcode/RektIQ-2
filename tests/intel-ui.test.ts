/**
 * Phase 8 — Intel UI helpers (TDD red).
 */
import { describe, expect, it } from "vitest";
import { formatScore, scoreTone, formatPriceChange, staleLabel } from "@/lib/intel/format";

describe("intel format helpers", () => {
  it("formats score as 0-100 with tone", () => {
    expect(formatScore(82)).toBe("82");
    expect(formatScore(null)).toBe("—");
    expect(scoreTone(82)).toBe("bullish");
    expect(scoreTone(50)).toBe("neutral");
    expect(scoreTone(20)).toBe("bearish");
  });

  it("formats price change with sign", () => {
    expect(formatPriceChange(2.34)).toBe("+2.34%");
    expect(formatPriceChange(-1.2)).toBe("−1.20%");
    expect(formatPriceChange(0)).toBe("0.00%");
  });

  it("returns stale label", () => {
    expect(staleLabel(true)).toBe("stale");
    expect(staleLabel(false)).toBe("live");
  });
});
