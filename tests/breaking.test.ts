import { describe, expect, it, vi } from "vitest";

// Mock server-only module before importing
vi.mock("server-only", () => ({}));

import { evaluateBreaking, MIN_SCORE } from "@/lib/jobs/breaking";
import { scoreStory } from "@/lib/dedupe/score";
import { DEFAULT_SETTINGS } from "@/lib/settings";

const now = new Date("2026-09-24T12:00:00Z");
const minsAgo = (m: number) => new Date(now.getTime() - m * 60_000);
const story = (id: string, title: string, sources: string[], ageMin: number, categories: Parameters<typeof scoreStory>[0]["categories"] = []) => ({
  id, title, sources, firstPublishedAt: minsAgo(ageMin), lastPublishedAt: minsAgo(Math.max(0, ageMin - 20)),
  score: scoreStory({ title, sources, articleCount: sources.length, categories, coins: [], lastPublishedAt: minsAgo(Math.max(0, ageMin - 20)), now }),
});
const base = { postedStoryIds: new Set<string>(), alertsToday: 0, lastAlertAt: null, settings: DEFAULT_SETTINGS, now };

describe("breaking alerts", () => {
  const routine = story("r", "Wallet app adds dark mode", ["decrypt"], 30, ["technology"]);
  const wide = story("w", "Spot bitcoin ETFs see $1B inflows", ["coindesk", "the-block", "decrypt"], 50, ["etf", "bitcoin"]);
  const hack = story("h", "Exchange hacked for $200M", ["the-block"], 20, ["security"]);

  it("posts a story several newsrooms picked up within the hour", () => {
    const d = evaluateBreaking({ ...base, stories: [routine, wide] });
    expect(d.pick?.id).toBe("w");
    expect(d.reason).toMatch(/covered by 3 newsrooms/);
  });

  it("posts a high-impact single-source story on normal, not on strict", () => {
    expect(evaluateBreaking({ ...base, stories: [hack] }).pick?.id).toBe("h");
    expect(evaluateBreaking({ ...base, stories: [hack], settings: { ...DEFAULT_SETTINGS, breakingSensitivity: "strict" } }).pick).toBeUndefined();
  });

  it("never alerts on routine news", () => {
    expect(routine.score).toBeLessThan(MIN_SCORE.normal);
    expect(evaluateBreaking({ ...base, stories: [routine] }).pick).toBeUndefined();
  });

  it("ignores old stories and ones already posted", () => {
    const old = story("o", "Spot bitcoin ETFs see $1B inflows", ["coindesk", "the-block", "decrypt"], 5 * 60, ["etf"]);
    expect(evaluateBreaking({ ...base, stories: [old] }).pick).toBeUndefined();
    expect(evaluateBreaking({ ...base, stories: [wide], postedStoryIds: new Set(["w"]) }).pick).toBeUndefined();
  });

  it("respects the daily limit, the gap between alerts, and the off switch", () => {
    expect(evaluateBreaking({ ...base, stories: [wide], alertsToday: 3 }).skipped).toMatch(/limit/);
    expect(evaluateBreaking({ ...base, stories: [wide], lastAlertAt: minsAgo(30) }).skipped).toMatch(/13:00 UTC/);
    expect(evaluateBreaking({ ...base, stories: [wide], lastAlertAt: minsAgo(120) }).pick?.id).toBe("w");
    expect(evaluateBreaking({ ...base, stories: [wide], settings: { ...DEFAULT_SETTINGS, breakingEnabled: false } }).skipped).toMatch(/off/);
  });
});
