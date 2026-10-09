import { createHash } from "node:crypto";
import { z } from "zod";

export const SENTIMENT_SCHEMA_VERSION = "social-sentiment-v2";
export const SENTIMENT_PROMPT_VERSION = "social-post-classifier-v2";
export const SENTIMENT_FORMULA_VERSION = "author-consensus-v2";
export const NEWS_SENTIMENT_PROMPT_VERSION = "crypto-news-sentiment-v1";

const resultSchema = z.object({
  postId: z.string().min(1),
  sentiment: z.enum(["positive", "neutral", "negative"]),
  score: z.number().min(-100).max(100),
  confidence: z.number().min(0).max(1),
  symbols: z.array(z.string().min(1).max(20)).max(8),
  contextReferences: z.array(z.object({
    postId: z.string().min(1),
    symbol: z.string().min(1).max(20),
  })).max(8).default([]),
  coinMentions: z.array(z.object({
    name: z.string().trim().min(2).max(80),
    symbol: z.string().trim().min(1).max(20).nullable().default(null),
    chain: z.string().trim().min(1).max(40).nullable().default(null),
    contractAddress: z.string().trim().min(8).max(100).nullable().default(null),
    evidence: z.string().trim().min(2).max(240),
    contextPostId: z.string().min(1).nullable().default(null),
  })).max(8).default([]),
  summary: z.string().min(8).max(240),
});

const responseSchema = z.object({ results: z.array(resultSchema).max(30) });
export type SentimentResult = z.infer<typeof resultSchema>;

export type SentimentContextInput = {
  id: string;
  text: string;
  publishedAt: string;
  sourceUrl: string;
  verifiedSymbols: string[];
  relation: "explicit-reference" | "thread" | "same-author";
};
export type SentimentPostInput = { id: string; text: string; context?: SentimentContextInput[] };
export type SentimentAssetInput = { symbol: string; name: string; chain: string | null; contractAddress: string | null };
export type CoinMention = {
  name: string;
  symbol: string | null;
  chain: string | null;
  contractAddress: string | null;
  evidence: string;
  contextPostId: string | null;
};

export function findExplicitAssetSymbols(text: string, assets: SentimentAssetInput[]) {
  const found = new Set<string>();
  for (const asset of assets) {
    const symbol = asset.symbol.toUpperCase();
    const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const explicitSymbol = new RegExp(`(?:\\$|#)${escaped}(?![A-Z0-9])`, "i").test(text) ||
      (symbol.length >= 3 && new RegExp(`\\b${escaped}\\b`).test(text));
    const escapedName = asset.name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const explicitName = escapedName.length >= 4 && new RegExp(`\\b${escapedName}\\b`, "i").test(text);
    if (explicitSymbol || explicitName) found.add(symbol);
  }
  return [...found];
}

export function parseSentimentResponse(raw: string, posts: SentimentPostInput[], assets: SentimentAssetInput[]): SentimentResult[] {
  const clean = raw.replace(/```(?:json)?/gi, "").trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Sentiment model returned no JSON object.");
  const parsed = responseSchema.parse(JSON.parse(clean.slice(start, end + 1)));
  const postsById = new Map(posts.map((post) => [post.id, post]));
  const allowedSymbols = new Map(assets.map((asset) => [asset.symbol.toUpperCase(), asset]));
  const seen = new Set<string>();
  return parsed.results.flatMap((result) => {
    const post = postsById.get(result.postId);
    if (!post || seen.has(result.postId)) return [];
    seen.add(result.postId);
    const directSymbols = new Set(findExplicitAssetSymbols(post.text, assets));
    const contextById = new Map((post.context ?? []).map((context) => [context.id, context]));
    const contextReferences = result.contextReferences.flatMap((reference) => {
      const context = contextById.get(reference.postId);
      const symbol = reference.symbol.toUpperCase();
      if (!context || !context.verifiedSymbols.includes(symbol) || !allowedSymbols.has(symbol)) return [];
      return [{ postId: reference.postId, symbol }];
    });
    const contextualSymbols = new Set(contextReferences.map((reference) => reference.symbol));
    const symbols = [...new Set(result.symbols.map((symbol) => symbol.toUpperCase())
      .filter((symbol) => allowedSymbols.has(symbol) && (directSymbols.has(symbol) || contextualSymbols.has(symbol))))];
    const coinMentions = result.coinMentions.flatMap((mention) => {
      const context = mention.contextPostId ? contextById.get(mention.contextPostId) : null;
      const evidenceText = context && context.relation !== "same-author" ? context.text : post.text;
      if (!evidenceText.toLocaleLowerCase().includes(mention.evidence.toLocaleLowerCase())) return [];
      const evidence = mention.evidence.toLocaleLowerCase();
      const escapedName = mention.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const nameIsQuoted = mention.name.length >= 4 &&
        new RegExp(`(?:^|[^A-Z0-9])${escapedName}(?:$|[^A-Z0-9])`, "i").test(mention.evidence);
      const symbolIsQuoted = mention.symbol !== null &&
        new RegExp(`(?:\\$|#)?${mention.symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Z0-9])`, "i")
          .test(mention.evidence);
      const addressIsQuoted = mention.contractAddress !== null &&
        evidence.includes(mention.contractAddress.toLocaleLowerCase());
      const urlIsQuoted = /https?:\/\/\S+/i.test(mention.evidence);
      if (!nameIsQuoted && !symbolIsQuoted && !addressIsQuoted && !urlIsQuoted) return [];
      return [{
        ...mention,
        symbol: mention.symbol?.toUpperCase() ?? null,
        contextPostId: context && context.relation !== "same-author" ? context.id : null,
      }];
    });
    return [{
      ...result,
      contextReferences: contextReferences.filter((reference) => symbols.includes(reference.symbol)),
      symbols,
      coinMentions,
    }];
  });
}

export function sentimentAnalysisKey(postId: string, assetId: string | null) {
  return createHash("sha256")
    .update(`${SENTIMENT_SCHEMA_VERSION}:${postId}:${assetId ?? "unattributed"}`)
    .digest("hex");
}

export function newsSentimentAnalysisKey(articleId: string) {
  return createHash("sha256")
    .update(`${NEWS_SENTIMENT_PROMPT_VERSION}:${articleId}`)
    .digest("hex");
}

export function newsSentimentContentHash(title: string, summary: string) {
  return createHash("sha256").update(`${title.trim()}:${summary.trim()}`).digest("hex");
}

export function isWithinSentimentWindow(publishedAt: Date, now: Date, windowHours: number) {
  const age = now.getTime() - publishedAt.getTime();
  return age >= 0 && age <= windowHours * 3600_000;
}

export function aggregateSentiment(rows: { score: number; confidence: number; sentiment: string }[]) {
  if (!rows.length) return null;
  const weight = rows.reduce((total, row) => total + Math.max(0.05, row.confidence), 0);
  const score = rows.reduce((total, row) => total + row.score * Math.max(0.05, row.confidence), 0) / weight;
  const counts = rows.reduce(
    (result, row) => {
      if (row.sentiment === "positive") result.positive++;
      else if (row.sentiment === "negative") result.negative++;
      else result.neutral++;
      return result;
    },
    { positive: 0, neutral: 0, negative: 0 },
  );
  return {
    score: Math.round(Math.max(-100, Math.min(100, score))),
    confidence: Math.round((weight / rows.length) * 100) / 100,
    counts,
    direction: score >= 15 ? "bullish" as const : score <= -15 ? "bearish" as const : "neutral" as const,
  };
}

export function aggregateAuthorConsensus(
  rows: { authorId: string; score: number; confidence: number; sentiment: string }[],
) {
  const rowsByAuthor = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = row.authorId.trim().replace(/^@/, "").toLocaleLowerCase();
    if (!key) continue;
    const authorRows = rowsByAuthor.get(key);
    if (authorRows) authorRows.push(row);
    else rowsByAuthor.set(key, [row]);
  }
  const authorSummaries = [...rowsByAuthor.entries()].flatMap(([authorId, authorRows]) => {
    const aggregate = aggregateSentiment(authorRows);
    return aggregate ? [{
      ...aggregate,
      authorId,
      sentiment: aggregate.direction === "bullish" ? "positive" :
        aggregate.direction === "bearish" ? "negative" : "neutral",
    }] : [];
  });
  const authors = authorSummaries;
  const aggregate = aggregateSentiment(authors);
  if (!aggregate) return null;
  const supportingAuthors = authorSummaries
    .filter((author) => author.direction === aggregate.direction)
    .map((author) => author.authorId);
  const alignedAuthors = supportingAuthors.length;
  const distinctAuthors = authors.length;
  const consensusRatio = distinctAuthors ? alignedAuthors / distinctAuthors : 0;
  if (aggregate.direction === "neutral" || alignedAuthors < 2 || consensusRatio < 2 / 3) return null;
  return {
    ...aggregate,
    distinctAuthors,
    alignedAuthors,
    supportingAuthors,
    consensusRatio: Math.round(consensusRatio * 100) / 100,
    sampleCount: rows.length,
  };
}

export type MarketPricePoint = { sampledAt: Date; price: number; stale: boolean };

export function confirmMarketDirection(
  points: MarketPricePoint[],
  now: Date,
  direction: "bullish" | "bearish",
) {
  const usable = points
    .filter((point) => !point.stale && Number.isFinite(point.price) && point.price > 0 &&
      Number.isFinite(point.sampledAt.getTime()) && point.sampledAt <= now)
    .sort((left, right) => left.sampledAt.getTime() - right.sampledAt.getTime());
  const first = usable[0];
  const last = usable[usable.length - 1];
  if (!first || !last || usable.length < 2 ||
    last.sampledAt.getTime() < now.getTime() - 5 * 60_000 ||
    last.sampledAt.getTime() - first.sampledAt.getTime() < 90 * 60_000) return "unavailable" as const;
  const change = (last.price - first.price) / first.price;
  return (direction === "bullish" ? change > 0 : change < 0)
    ? "confirmed" as const
    : "opposed" as const;
}
