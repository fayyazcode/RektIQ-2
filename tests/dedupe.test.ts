import { describe, expect, it } from "vitest";
import { normalizeNumbers, similarity, tokenize, SAME_STORY_THRESHOLD } from "@/lib/dedupe/similarity";
import { findMatchingStory, type StoryCandidate } from "@/lib/dedupe/cluster";
import { scoreStory } from "@/lib/dedupe/score";

const mk = (title: string, summary = "") => ({ titleTokens: tokenize(title), tokens: tokenize(`${title} ${summary}`) });

describe("number normalization", () => {
  it("unifies money formats", () => {
    expect(normalizeNumbers("$900 million")).toBe("900m");
    expect(normalizeNumbers("$118,000")).toBe("118k");
    expect(normalizeNumbers("$1.2B")).toBe("1.2b");
  });
});

describe("similarity", () => {
  it("matches the same event reported by different newsrooms", () => {
    const pairs: [string, string][] = [
      ["Spot Bitcoin ETFs Record $900M Inflows, Biggest Day Since July", "Bitcoin ETFs pull in $900 million in largest daily inflow since July"],
      ["Hyperliquid Exploited for $12M in Oracle Manipulation Attack", "Attacker drains $12 million from Hyperliquid via oracle manipulation"],
      ["SEC Delays Decision on Staking in Ether ETFs", "SEC pushes back ruling on ether ETF staking to November"],
      ["Coinbase Q3 Earnings Beat Estimates", "Coinbase posts Q3 revenue above expectations"],
      ["Trump Signs Stablecoin Bill Into Law", "President Trump signs GENIUS stablecoin act"],
    ];
    for (const [a, b] of pairs) expect(similarity(mk(a), mk(b)), `${a} ~ ${b}`).toBeGreaterThanOrEqual(SAME_STORY_THRESHOLD);
  });

  it("keeps different events apart", () => {
    const pairs: [string, string][] = [
      ["Bitcoin Falls Below $110K as Liquidations Mount", "Bitcoin Miners Sell Coins as Hashprice Slides"],
      ["Bitcoin Rises to $120K", "Bitcoin Falls to $95K"],
      ["Ethereum Developers Set Date for Fusaka Upgrade", "Solana DEX Volume Beats Ethereum Again"],
      ["Coinbase Adds Support for Base Network Tokens", "Kraken Files for IPO in New York"],
      ["Tether Mints $1B USDT", "Circle Mints $1B USDC"],
      ["Binance Lists New Token XYZ", "Coinbase Lists New Token XYZ"],
      ["Bitcoin ETFs See $400M Outflows", "Ether ETFs Log $200M Inflows"],
      ["Bitcoin Price Today: BTC Holds $115K", "Bitcoin Price Today: BTC Slips to $112K"],
    ];
    for (const [a, b] of pairs) expect(similarity(mk(a), mk(b)), `${a} !~ ${b}`).toBeLessThan(SAME_STORY_THRESHOLD);
  });
});

describe("findMatchingStory", () => {
  const now = new Date("2026-09-22T12:00:00Z");
  const story = (id: string, title: string, sources: string[], hoursAgo = 1): StoryCandidate => ({
    id, ...mk(title), sources, lastPublishedAt: new Date(now.getTime() - hoursAgo * 3600_000), firstPublishedAt: new Date(now.getTime() - hoursAgo * 3600_000),
  });

  it("merges a second outlet's version into the existing story", () => {
    const candidates = [story("s1", "Spot Bitcoin ETFs Record $900M Inflows", ["coindesk"]), story("s2", "Solana DEX Volume Beats Ethereum", ["decrypt"])];
    const m = findMatchingStory({ ...mk("Bitcoin ETFs Pull In $900 Million in a Single Day"), source: "the-block", publishedAt: now }, candidates);
    expect(m?.id).toBe("s1");
  });

  it("treats a same-outlet follow-up as a new story unless near-identical", () => {
    const candidates = [story("s1", "SEC Sues Crypto Exchange Over Unregistered Securities", ["coindesk"])];
    const followUp = findMatchingStory({ ...mk("Crypto Exchange Responds to SEC Lawsuit, Plans Appeal"), source: "coindesk", publishedAt: now }, candidates);
    expect(followUp).toBeNull();
  });

  it("ignores stories outside the time window", () => {
    const candidates = [story("old", "Spot Bitcoin ETFs Record $900M Inflows", ["coindesk"], 60)];
    expect(findMatchingStory({ ...mk("Bitcoin ETFs Record $900M Inflows"), source: "decrypt", publishedAt: now }, candidates)).toBeNull();
  });
});

describe("scoreStory", () => {
  it("ranks wide coverage and hacks above single-source routine news", () => {
    const now = new Date();
    const hack = scoreStory({ title: "Exchange hacked for $200M", sources: ["coindesk", "decrypt", "the-block"], articleCount: 3, categories: ["security"], coins: [], lastPublishedAt: now, now });
    const routine = scoreStory({ title: "Wallet adds dark mode", sources: ["decrypt"], articleCount: 1, categories: ["technology"], coins: [], lastPublishedAt: now, now });
    expect(hack).toBeGreaterThan(routine * 2);
  });
});
