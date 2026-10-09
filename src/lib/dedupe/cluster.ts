import { similarity, overlap, SAME_SOURCE_THRESHOLD, SAME_STORY_THRESHOLD, type Comparable } from "./similarity";

export type StoryCandidate = Comparable & {
  id: string;
  sources: string[];
  lastPublishedAt: Date;
  firstPublishedAt: Date;
};

export type ArticleForMatch = Comparable & { source: string; publishedAt: Date };

const MAX_GAP_MS = 36 * 3600_000;

/**
 * Finds the existing story this article is covering, if any.
 * Returns null when the article is a new development.
 */
export function findMatchingStory(article: ArticleForMatch, candidates: StoryCandidate[]): { id: string; score: number } | null {
  let best: { id: string; score: number } | null = null;
  for (const c of candidates) {
    const gap = Math.min(
      Math.abs(article.publishedAt.getTime() - c.lastPublishedAt.getTime()),
      Math.abs(article.publishedAt.getTime() - c.firstPublishedAt.getTime())
    );
    if (gap > MAX_GAP_MS) continue;
    if (overlap(article.titleTokens, c.titleTokens) < 2 && overlap(article.tokens, c.tokens) < 4) continue;

    const score = similarity(article, c);
    // A second article from the same outlet is usually a follow-up, not a duplicate,
    // unless it's nearly identical.
    const onlySameSource = c.sources.length === 1 && c.sources[0] === article.source;
    const threshold = onlySameSource ? SAME_SOURCE_THRESHOLD : SAME_STORY_THRESHOLD;
    if (score >= threshold && (!best || score > best.score)) best = { id: c.id, score };
  }
  return best;
}
