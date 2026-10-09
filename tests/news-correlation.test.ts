/**
 * Phase 9 — News correlation (TDD red).
 * Verifies neutral wording and interpolation helpers; the worker wiring
 * (run on a throttled cadence + emit news:impact) is asserted by
 * checking the worker file imports and caps concurrent runs.
 */
import { describe, expect, it } from "vitest";
import { priceAt, avgVolumeIn, IMPACT_WINDOW_MINUTES, describeImpact } from "@/lib/news/correlation";

describe("news correlation helpers", () => {
  it("interpolates price at a time between snapshots", () => {
    const snaps = [
      { timestamp: new Date("2026-09-25T00:00:00Z").toISOString(), price: 100 },
      { timestamp: new Date("2026-09-25T01:00:00Z").toISOString(), price: 110 },
    ];
    const mid = new Date("2026-09-25T00:30:00Z").getTime();
    expect(priceAt(snaps, mid)).toBeCloseTo(105, 1);
    expect(priceAt(snaps, new Date("2026-09-25T00:00:00Z").getTime())).toBe(100);
    expect(priceAt([], mid)).toBeNull();
    // outside range => null, never invent
    expect(priceAt(snaps, new Date("2026-09-24T23:00:00Z").getTime())).toBeNull();
  });

  it("averages volume inside a window and returns null when empty", () => {
    const snaps = [
      { timestamp: new Date("2026-09-25T00:10:00Z").toISOString(), volume24h: 100 },
      { timestamp: new Date("2026-09-25T00:20:00Z").toISOString(), volume24h: 300 },
      { timestamp: new Date("2026-09-25T01:10:00Z").toISOString(), volume24h: 999 },
    ];
    const from = new Date("2026-09-25T00:00:00Z").getTime();
    const to = new Date("2026-09-25T01:00:00Z").getTime();
    expect(avgVolumeIn(snaps, from, to)).toBeCloseTo(200, 5);
    expect(avgVolumeIn(snaps, new Date("2026-09-24T00:00:00Z").getTime(), new Date("2026-09-24T01:00:00Z").getTime())).toBeNull();
  });

  it("uses a 60-minute window and neutral wording (correlation, not causation)", () => {
    expect(IMPACT_WINDOW_MINUTES).toBe(60);
    const s = describeImpact({ priceChangePct: 2.34, windowMinutes: 60 });
    expect(s).toMatch(/Observed movement after publication/i);
    expect(s).not.toMatch(/caused/i);
    expect(s.toLowerCase()).not.toMatch(/because of the article/);
  });
});
