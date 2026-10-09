import type { Category } from "../types";

const KEYWORDS: [RegExp, number][] = [
  [/\b(hack|hacked|exploit|breach|stolen|drained)\b/i, 3],
  [/\b(approv(es|ed|al)|rejects?|denies|lawsuit|charges|sues|settle(s|ment)?|ruling|verdict)\b/i, 2.5],
  [/\b(etf|sec|cftc|federal reserve|fed|rate cut|rate hike|treasury)\b/i, 2],
  [/\b(all-time high|record|ath|biggest|largest|first-ever)\b/i, 2],
  [/\b(liquidat\w+|crash|plunge|surge|soar)\w*\b/i, 1.5],
  [/\b(bankrupt\w*|insolven\w*|halts? withdrawals|delist\w*)\b/i, 2.5],
  [/\b(acquires?|acquisition|ipo|raises \$?\d)/i, 1],
];

const CATEGORY_WEIGHT: Partial<Record<Category, number>> = {
  bitcoin: 1, ethereum: 0.8, etf: 1, regulation: 1, security: 1, markets: 0.6, stablecoins: 0.6, policy: 0.6,
};

/**
 * Importance of a story. Cross-newsroom coverage is the strongest signal:
 * if four outlets wrote it up independently, it matters.
 */
export function scoreStory(input: {
  title: string;
  sources: string[];
  articleCount: number;
  categories: Category[];
  coins: string[];
  lastPublishedAt: Date;
  now?: Date;
}): number {
  const now = input.now ?? new Date();
  const hours = Math.max(0, (now.getTime() - input.lastPublishedAt.getTime()) / 3600_000);
  const coverage = input.sources.length * 3 + Math.min(3, input.articleCount - input.sources.length) * 0.5;
  const keywords = KEYWORDS.reduce((s, [re, w]) => s + (re.test(input.title) ? w : 0), 0);
  const cats = input.categories.reduce((s, c) => s + (CATEGORY_WEIGHT[c] ?? 0), 0);
  const majors = input.coins.filter((c) => c === "BTC" || c === "ETH").length * 0.5;
  const freshness = 6 * Math.exp(-hours / 12);
  return Math.round((coverage + keywords + cats + majors + freshness) * 100) / 100;
}
