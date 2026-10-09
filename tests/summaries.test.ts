import { describe, expect, it } from "vitest";
import { parseSummary } from "@/lib/ai/summarize";

const input = {
  title: "Spot bitcoin ETFs record $900M inflows",
  articles: [
    { source: "coindesk", title: "Spot bitcoin ETFs record $900M inflows", summary: "US spot bitcoin ETFs took in $900 million on Monday, the most since July.", publishedAt: new Date() },
    { source: "the-block", title: "BlackRock's IBIT leads ETF inflows", summary: "IBIT accounted for $500 million of the day's flows.", publishedAt: new Date() },
  ],
};

describe("AI story summaries", () => {
  it("accepts a summary whose figures all come from the reporting", () => {
    const s = parseSummary(JSON.stringify({
      whatHappened: "US spot bitcoin ETFs drew $900 million in one day, their biggest intake since July, with BlackRock's IBIT taking $500 million.",
      whyItMatters: "Large ETF inflows show institutional demand for bitcoin is strong.",
      keyFacts: ["$900M total inflows on Monday", "IBIT: $500M", "Largest day since July"],
    }), input);
    expect(s?.keyFacts).toHaveLength(3);
  });

  it("drops invented facts and rejects an invented main text", () => {
    const s = parseSummary(JSON.stringify({
      whatHappened: "US spot bitcoin ETFs drew $900 million in one day, the most since July, led by BlackRock's IBIT.",
      whyItMatters: "It signals strong institutional demand.",
      keyFacts: ["$900M total inflows", "Bitcoin rose 7% on the news"],
    }), input);
    expect(s?.keyFacts).toEqual(["$900M total inflows"]);
    const bad = parseSummary(JSON.stringify({ whatHappened: "ETFs drew $1.4 billion in a single day, a new all-time record for the products.", whyItMatters: "Demand is strong.", keyFacts: ["x fact"] }), input);
    expect(bad).toBeNull();
  });
});
