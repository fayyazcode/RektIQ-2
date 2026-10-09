/**
 * Pure (database-free) core of the hourly ingest, so the redundancy logic can
 * be unit-tested hour-over-hour without a database connection.
 */
import { randomUUID } from "crypto";
import { findMatchingStory, type StoryCandidate } from "../dedupe/cluster";
import { slugify } from "../normalize/text";
import type { ArticleDoc, NormalizedArticle, StoryDoc } from "../types";

export type ExistingArticle = { _id: string; contentHash: string; storyId: string | null };

export type StoryPush = {
  articleIds: string[];
  sources: string[];
  categories: StoryDoc["categories"];
  coins: string[];
  maxPublished: Date;
  minPublished: Date;
};

export type IngestPlan = {
  duplicatesInBatch: number;
  unchanged: number;
  edited: { id: string; storyId: string | null; article: NormalizedArticle }[];
  newArticles: ArticleDoc[];
  newStories: StoryDoc[];
  /** Articles to attach to stories (existing ones, or ones created earlier in this plan) */
  storyPushes: Map<string, StoryPush>;
  mergedIntoStories: number;
  touchedStoryIds: Set<string>;
};

/** Same canonical URL twice in one fetch (e.g. listed in two feeds) → keep the first. */
export function dedupeBatch(articles: NormalizedArticle[]): { unique: NormalizedArticle[]; duplicates: number } {
  const seen = new Map<string, NormalizedArticle>();
  let duplicates = 0;
  for (const a of articles) {
    if (seen.has(a.urlHash)) duplicates++;
    else seen.set(a.urlHash, a);
  }
  return { unique: [...seen.values()], duplicates };
}

export function planIngest(input: {
  batch: NormalizedArticle[];
  existing: Map<string, ExistingArticle>; // by urlHash
  candidates: StoryCandidate[]; // recent stories (mutated as new stories are created)
  storyByTitleHash: Map<string, string>; // exact headline matches from recent history
  now: Date;
  runId: string | null;
}): IngestPlan {
  const { unique, duplicates } = dedupeBatch(input.batch);
  const plan: IngestPlan = {
    duplicatesInBatch: duplicates,
    unchanged: 0,
    edited: [],
    newArticles: [],
    newStories: [],
    storyPushes: new Map(),
    mergedIntoStories: 0,
    touchedStoryIds: new Set(),
  };

  // 1. Compare with previous hours: unchanged / edited / new
  const fresh: NormalizedArticle[] = [];
  for (const a of unique) {
    const prev = input.existing.get(a.urlHash);
    if (!prev) fresh.push(a);
    else if (prev.contentHash !== a.contentHash) {
      plan.edited.push({ id: prev._id, storyId: prev.storyId, article: a });
      if (prev.storyId) plan.touchedStoryIds.add(prev.storyId.toString());
    } else plan.unchanged++;
  }

  // 2. Cluster new articles, oldest first, so the first report becomes the story's headline
  fresh.sort((x, y) => x.publishedAt.getTime() - y.publishedAt.getTime());
  const titleHashToStory = new Map(input.storyByTitleHash);

  for (const a of fresh) {
    const articleId = randomUUID();
    let storyId = titleHashToStory.get(a.titleHash) ?? findMatchingStory(a, input.candidates)?.id ?? null;

    if (storyId) {
      plan.mergedIntoStories++;
      const p = plan.storyPushes.get(storyId) ?? { articleIds: [], sources: [], categories: [], coins: [], maxPublished: a.publishedAt, minPublished: a.publishedAt };
      p.articleIds.push(articleId);
      if (!p.sources.includes(a.source)) p.sources.push(a.source);
      for (const cat of a.categories) if (!p.categories.includes(cat)) p.categories.push(cat);
      for (const coin of a.coins) if (!p.coins.includes(coin)) p.coins.push(coin);
      if (a.publishedAt > p.maxPublished) p.maxPublished = a.publishedAt;
      if (a.publishedAt < p.minPublished) p.minPublished = a.publishedAt;
      plan.storyPushes.set(storyId, p);
      const cand = input.candidates.find((c) => c.id === storyId);
      if (cand) {
        if (!cand.sources.includes(a.source)) cand.sources.push(a.source);
        if (a.publishedAt > cand.lastPublishedAt) cand.lastPublishedAt = a.publishedAt;
      }
    } else {
      storyId = randomUUID();
      plan.newStories.push({
        _id: storyId,
        slug: slugify(a.title, storyId.slice(-6)),
        title: a.title,
        summary: a.summary,
        primaryArticleId: articleId,
        articleIds: [articleId],
        sources: [a.source],
        categories: a.categories,
        coins: a.coins,
        titleTokens: a.titleTokens,
        tokens: a.tokens,
        firstPublishedAt: a.publishedAt,
        lastPublishedAt: a.publishedAt,
        createdAt: input.now,
        updatedAt: input.now,
        score: 0,
      });
      input.candidates.push({ id: storyId, titleTokens: a.titleTokens, tokens: a.tokens, sources: [a.source], lastPublishedAt: a.publishedAt, firstPublishedAt: a.publishedAt });
    }
    titleHashToStory.set(a.titleHash, storyId);
    plan.touchedStoryIds.add(storyId);
    const { tokens: _t, titleTokens: _tt, ...stored } = a;
    plan.newArticles.push({ ...stored, _id: articleId, storyId, fetchedAt: input.now, updatedAt: input.now, version: 1, firstRunId: input.runId });
  }
  return plan;
}
