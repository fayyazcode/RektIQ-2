/**
 * Daily cleanup: keeps the database to the searchable window (RETENTION_DAYS, default 30)
 * and drops data that's only needed briefly.
 *
 *   - stories last updated before the cutoff, and their articles
 *   - stray articles older than the cutoff (+7 days grace) with no live story
 *   - automation runs and X posts older than the cutoff
 *   - similarity tokens on stories past the 48 h matching window
 *   - feed state for sources that were removed from the config
 */
import { and, eq, inArray, isNotNull, lt, notInArray, sql } from "drizzle-orm";
import { getPostgresDb } from "../db/client";
import { stories, articles, automationRuns, outboundPosts, feedState, storyArticles, socialPosts, socialAnalyses, socialSignals, aiAnalyses } from "../db/schema";
import { CLUSTER_WINDOW_HOURS, RETENTION_DAYS, retentionCutoff } from "../config";
import { getFeedSources } from "../feeds/registry";
import type { RunDoc } from "../types";

const CHUNK = 1000;

export async function runCleanup(trigger: RunDoc["trigger"] = "schedule") {
  const db = getPostgresDb();
  const now = new Date();
  const cutoff = retentionCutoff(now);
  const [{ id: runId }] = await db
    .insert(automationRuns)
    .values({ kind: "cleanup", trigger, startedAt: now, completedAt: null, status: "running" })
    .returning({ id: automationRuns.id });
  const removed: Record<string, number> = { stories: 0, articles: 0, runs: 0, posts: 0, feedState: 0, tokensTrimmed: 0, socialTextExpired: 0, socialPosts: 0, socialAnalyses: 0, socialSignals: 0, newsSentimentAnalyses: 0 };

  try {
    // 1. Expired stories and their articles, in chunks so the first run on a big DB stays fast
    for (;;) {
      const batch = await db.select({ id: stories.id }).from(stories).where(lt(stories.lastPublishedAt, cutoff)).limit(CHUNK);
      if (!batch.length) break;
      const ids = batch.map((s) => s.id);
      const articleIdsResult = await db
        .select({ articleId: storyArticles.articleId })
        .from(storyArticles)
        .where(inArray(storyArticles.storyId, ids));
      const articleIds = articleIdsResult.map((r) => r.articleId);
      if (articleIds.length) {
        await db.delete(storyArticles).where(inArray(storyArticles.storyId, ids));
        removed.articles += articleIds.length;
        await db.delete(articles).where(inArray(articles.id, articleIds));
      }
      await db.delete(stories).where(inArray(stories.id, ids));
      removed.stories += batch.length;
      if (batch.length < CHUNK) break;
    }

    // 2. Stray articles (no story, or story already gone) well past the window
    const graceCutoff = new Date(cutoff.getTime() - 7 * 86400_000);
    const strayArticles = await db
      .select({ id: articles.id })
      .from(articles)
      .leftJoin(storyArticles, eq(articles.id, storyArticles.articleId))
      .where(and(lt(articles.publishedAt, graceCutoff), sql`${storyArticles.articleId} IS NULL`));
    if (strayArticles.length) {
      const strayIds = strayArticles.map((a) => a.id);
      await db.delete(articles).where(inArray(articles.id, strayIds));
      removed.articles += strayArticles.length;
    }

    // 3. Old runs and posts
    const runsToDelete = await db
      .select({ id: automationRuns.id })
      .from(automationRuns)
      .where(and(lt(automationRuns.startedAt, cutoff), sql`${automationRuns.id} != ${runId}`));
    if (runsToDelete.length) {
      await db.delete(automationRuns).where(inArray(automationRuns.id, runsToDelete.map((r) => r.id)));
      removed.runs = runsToDelete.length;
    }
    const postsToDelete = await db
      .select({ id: outboundPosts.id })
      .from(outboundPosts)
      .where(lt(outboundPosts.scheduledAt, cutoff));
    if (postsToDelete.length) {
      await db.delete(outboundPosts).where(inArray(outboundPosts.id, postsToDelete.map((p) => p.id)));
      removed.posts = postsToDelete.length;
    }

    // Keep social post metadata and evidence, but erase source text at the schema's 20-day limit.
    for (;;) {
      const expiredText = await db.select({ id: socialPosts.id }).from(socialPosts)
        .where(and(isNotNull(socialPosts.rawText), lt(socialPosts.rawTextExpiresAt, now)))
        .limit(CHUNK);
      if (!expiredText.length) break;
      await db.update(socialPosts)
        .set({ rawText: null, updatedAt: now })
        .where(inArray(socialPosts.id, expiredText.map((post) => post.id)));
      removed.socialTextExpired += expiredText.length;
      if (expiredText.length < CHUNK) break;
    }

    for (;;) {
      const oldSignals = await db.select({ id: socialSignals.id }).from(socialSignals).where(lt(socialSignals.createdAt, cutoff)).limit(CHUNK);
      if (!oldSignals.length) break;
      await db.delete(socialSignals).where(inArray(socialSignals.id, oldSignals.map((row) => row.id)));
      removed.socialSignals += oldSignals.length;
      if (oldSignals.length < CHUNK) break;
    }
    for (;;) {
      const oldAnalyses = await db.select({ id: socialAnalyses.id }).from(socialAnalyses).where(lt(socialAnalyses.analyzedAt, cutoff)).limit(CHUNK);
      if (!oldAnalyses.length) break;
      await db.delete(socialAnalyses).where(inArray(socialAnalyses.id, oldAnalyses.map((row) => row.id)));
      removed.socialAnalyses += oldAnalyses.length;
      if (oldAnalyses.length < CHUNK) break;
    }
    for (;;) {
      const oldNewsAnalyses = await db.select({ id: aiAnalyses.id }).from(aiAnalyses)
        .where(and(eq(aiAnalyses.kind, "news_sentiment_fallback"), lt(aiAnalyses.createdAt, cutoff)))
        .limit(CHUNK);
      if (!oldNewsAnalyses.length) break;
      await db.delete(aiAnalyses).where(inArray(aiAnalyses.id, oldNewsAnalyses.map((row) => row.id)));
      removed.newsSentimentAnalyses += oldNewsAnalyses.length;
      if (oldNewsAnalyses.length < CHUNK) break;
    }
    for (;;) {
      const oldSocialPosts = await db.select({ id: socialPosts.id }).from(socialPosts).where(lt(socialPosts.publishedAt, cutoff)).limit(CHUNK);
      if (!oldSocialPosts.length) break;
      await db.delete(socialPosts).where(inArray(socialPosts.id, oldSocialPosts.map((row) => row.id)));
      removed.socialPosts += oldSocialPosts.length;
      if (oldSocialPosts.length < CHUNK) break;
    }

    // 4. Tokens are only used to match new articles within the clustering window
    const matchCutoff = new Date(now.getTime() - (CLUSTER_WINDOW_HOURS + 24) * 3600_000);
    const storiesToTrim = await db
      .select({ id: stories.id })
      .from(stories)
      .where(and(lt(stories.lastPublishedAt, matchCutoff), sql`array_length(${stories.tokens}, 1) IS NOT NULL`));
    if (storiesToTrim.length) {
      await db
        .update(stories)
        .set({ titleTokens: [], tokens: [] })
        .where(inArray(stories.id, storiesToTrim.map((s) => s.id)));
      removed.tokensTrimmed = storiesToTrim.length;
    }

    // 5. Feed state for sources no longer configured
    const activeFeeds = await getFeedSources();
    if (activeFeeds.length) {
      const feedStateToDelete = await db
        .select({ sourceId: feedState.sourceId })
        .from(feedState)
        .where(notInArray(feedState.sourceId, activeFeeds.map((f) => f.id)));
      if (feedStateToDelete.length) {
        await db.delete(feedState).where(inArray(feedState.sourceId, feedStateToDelete.map((f) => f.sourceId)));
        removed.feedState = feedStateToDelete.length;
      }
    }

    const total = removed.stories + removed.articles + removed.runs + removed.posts + removed.feedState + removed.socialTextExpired + removed.socialPosts + removed.socialAnalyses + removed.socialSignals + removed.newsSentimentAnalyses;
    const message = `Kept the last ${RETENTION_DAYS} days. Removed ${removed.stories} stories, ${removed.articles} articles, ${removed.posts} outbound posts, ${removed.runs} runs, ${removed.socialPosts} social posts, ${removed.socialAnalyses} X analyses, ${removed.newsSentimentAnalyses} news sentiment analyses, and ${removed.socialSignals} sentiment signals; expired ${removed.socialTextExpired} older social post texts and trimmed matching data from ${removed.tokensTrimmed} stories.`;
    await db
      .update(automationRuns)
      .set({ completedAt: new Date(), status: "success", removed, message })
      .where(eq(automationRuns.id, runId));
    return { runId, status: "success" as const, removed, total, message };
  } catch (err) {
    await db
      .update(automationRuns)
      .set({ completedAt: new Date(), status: "failed", removed, error: err instanceof Error ? err.stack ?? err.message : String(err) })
      .where(eq(automationRuns.id, runId));
    throw err;
  }
}
