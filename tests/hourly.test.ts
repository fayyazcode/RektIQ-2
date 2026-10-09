import { describe, expect, it } from "vitest";
import { FEEDS } from "@/lib/config";
import { normalizeItem, type RawItem } from "@/lib/normalize/article";
import { planIngest, type ExistingArticle } from "@/lib/jobs/plan";
import type { StoryCandidate } from "@/lib/dedupe/cluster";
import type { ArticleDoc, NormalizedArticle, StoryDoc } from "@/lib/types";

const feed = (id: string) => FEEDS.find((f) => f.id === id)!;

function norm(source: string, item: RawItem, now: Date): NormalizedArticle {
  const r = normalizeItem(item, feed(source), now);
  if (!r.ok) throw new Error(`fixture rejected: ${r.reason}`);
  return r.article;
}

/** Minimal in-memory stand-in for the two collections the planner reads. */
class Store {
  articles = new Map<string, ArticleDoc>();
  stories = new Map<string, StoryDoc>();

  run(batch: NormalizedArticle[], now: Date) {
    const existing = new Map<string, ExistingArticle>();
    for (const a of batch) {
      const hit = this.articles.get(a.urlHash);
      if (hit) existing.set(a.urlHash, { _id: hit._id!, contentHash: hit.contentHash, storyId: hit.storyId });
    }
    const candidates: StoryCandidate[] = [...this.stories.values()].map((s) => ({
      id: s._id!.toString(), titleTokens: s.titleTokens, tokens: s.tokens, sources: [...s.sources], lastPublishedAt: s.lastPublishedAt, firstPublishedAt: s.firstPublishedAt,
    }));
    const byTitle = new Map([...this.articles.values()].filter((a) => a.storyId).map((a) => [a.titleHash, a.storyId!.toString()]));
    const plan = planIngest({ batch, existing, candidates, storyByTitleHash: byTitle, now, runId: null });

    for (const e of plan.edited) {
      const doc = [...this.articles.values()].find((x) => x._id === e.id)!;
      Object.assign(doc, { title: e.article.title, contentHash: e.article.contentHash, version: doc.version + 1 });
    }
    for (const s of plan.newStories) this.stories.set(s._id!.toString(), { ...s });
    for (const a of plan.newArticles) this.articles.set(a.urlHash, a);
    for (const [sid, p] of plan.storyPushes) {
      const s = this.stories.get(sid)!;
      for (const id of p.articleIds) {
        const exists = s.articleIds.some((x) => x === id);
        if (!exists) s.articleIds.push(id);
      }
      for (const src of p.sources) if (!s.sources.includes(src)) s.sources.push(src);
      if (p.maxPublished > s.lastPublishedAt) s.lastPublishedAt = p.maxPublished;
    }
    return plan;
  }
}

describe("hour-over-hour ingest", () => {
  const h1 = new Date("2026-09-22T10:07:00Z");
  const h2 = new Date("2026-09-22T11:07:00Z");

  const hour1: NormalizedArticle[] = [
    norm("coindesk", { title: "Spot Bitcoin ETFs Record $900M Inflows, Biggest Day Since July", link: "https://www.coindesk.com/markets/etf-inflows/?utm_source=rss", isoDate: "2026-09-22T09:30:00Z", contentSnippet: "US spot bitcoin ETFs took in $900 million on Monday." }, h1),
    norm("decrypt", { title: "Ethereum Developers Set Date for Fusaka Upgrade", link: "https://decrypt.co/1/eth-fusaka-date", isoDate: "2026-09-22T09:40:00Z", contentSnippet: "Core devs agreed on a mainnet date." }, h1),
    // Same CoinDesk article listed twice (e.g. two category feeds) → batch duplicate
    norm("coindesk", { title: "Spot Bitcoin ETFs Record $900M Inflows, Biggest Day Since July", link: "https://coindesk.com/markets/etf-inflows", isoDate: "2026-09-22T09:30:00Z", contentSnippet: "US spot bitcoin ETFs took in $900 million on Monday." }, h1),
    norm("the-block", { title: "Hyperliquid Exploited for $12M in Oracle Manipulation Attack", link: "https://www.theblock.co/post/1/hyperliquid-exploit", isoDate: "2026-09-22T09:50:00Z", contentSnippet: "An attacker manipulated an oracle." }, h1),
  ];

  const hour2: NormalizedArticle[] = [
    // Unchanged from last hour
    norm("decrypt", { title: "Ethereum Developers Set Date for Fusaka Upgrade", link: "https://decrypt.co/1/eth-fusaka-date", isoDate: "2026-09-22T09:40:00Z", contentSnippet: "Core devs agreed on a mainnet date." }, h2),
    // Same URL, publisher edited the headline
    norm("the-block", { title: "Hyperliquid Exploited for $12M; Team Pauses Bridge", link: "https://theblock.co/post/1/hyperliquid-exploit", isoDate: "2026-09-22T09:50:00Z", contentSnippet: "An attacker manipulated an oracle. The bridge is paused." }, h2),
    // Another newsroom covers last hour's ETF story → merged, not a new story
    norm("the-block", { title: "Bitcoin ETFs Pull In $900 Million in a Single Day", link: "https://www.theblock.co/post/2/btc-etf-900m", isoDate: "2026-09-22T10:20:00Z", contentSnippet: "Inflows into spot bitcoin ETFs hit $900 million." }, h2),
    // Syndicated copy with an identical headline → merged by exact title
    norm("cointelegraph", { title: "Hyperliquid Exploited for $12M in Oracle Manipulation Attack", link: "https://cointelegraph.com/news/hyperliquid-exploit", isoDate: "2026-09-22T10:30:00Z", contentSnippet: "Syndicated." }, h2),
    // Genuinely new development
    norm("bitcoin-magazine", { title: "Miners Move More Coins to Exchanges as Hashprice Slides", link: "https://bitcoinmagazine.com/markets/miners-hashprice", isoDate: "2026-09-22T10:45:00Z", contentSnippet: "Miner outflows hit a post-halving high." }, h2),
  ];

  it("classifies every item correctly across two runs", () => {
    const store = new Store();
    const p1 = store.run(hour1, h1);
    expect(p1.duplicatesInBatch).toBe(1);
    expect(p1.newArticles).toHaveLength(3);
    expect(p1.newStories).toHaveLength(3);
    expect(p1.mergedIntoStories).toBe(0);

    const p2 = store.run(hour2, h2);
    expect(p2.unchanged).toBe(1);
    expect(p2.edited).toHaveLength(1);
    expect(p2.newArticles).toHaveLength(3);
    expect(p2.mergedIntoStories).toBe(2);
    expect(p2.newStories).toHaveLength(1);

    const etf = [...store.stories.values()].find((s) => /ETF/.test(s.title))!;
    expect(etf.sources.sort()).toEqual(["coindesk", "the-block"]);
    expect(etf.articleIds).toHaveLength(2);
    expect(store.stories.size).toBe(4);
    expect(store.articles.size).toBe(6);
  });

  it("is idempotent: re-running the same hour changes nothing", () => {
    const store = new Store();
    store.run(hour1, h1);
    const again = store.run(hour1, h1);
    expect(again.newArticles).toHaveLength(0);
    expect(again.unchanged).toBe(3);
    expect(again.duplicatesInBatch).toBe(1);
  });
});
