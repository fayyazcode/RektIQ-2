/**
 * Hourly ingest job.
 *
 *   1. Conditional-GET all enabled feeds (unchanged feeds return 304 and are skipped)
 *   2. Normalize every item (URL canonicalization, text cleanup, taxonomy, tickers)
 *   3. Exact de-dup: within the batch, and against stored articles (by canonical URL hash)
 *      → unchanged / updated (publisher edited the headline or summary) / new
 *   4. Near-dup: match each new article against stories from the last 48 h
 *      → merge into an existing story, or start a new one
 *   5. Re-score touched stories, record a run with per-feed results and the delta vs the previous hour
 */
import { and, eq, gte, inArray, lt, or, sql } from "drizzle-orm";
import { getPostgresDb } from "../db/client";
import { articles, stories, automationRuns, feedState, storyArticles } from "../db/schema";
import { CLUSTER_WINDOW_HOURS } from "../config";
import { getFeedSources } from "../feeds/registry";
import { fetchFeed } from "../feeds/fetch";
import { normalizeItem } from "../normalize/article";
import type { StoryCandidate } from "../dedupe/cluster";
import { planIngest } from "./plan";
import { scoreStory } from "../dedupe/score";
import { getSettings } from "../settings";
import type { FeedRunResult, IngestStats, NormalizedArticle, RunDoc, StoryDoc } from "../types";

export async function runIngest(trigger: RunDoc["trigger"] = "schedule") {
  const db = getPostgresDb();
  const settings = await getSettings();
  const startedAt = new Date();
  // A job killed mid-run (runner timeout, crash) would otherwise stay "running" forever.
  await db
    .update(automationRuns)
    .set({ completedAt: startedAt, status: "failed", error: "Run did not finish (timed out or crashed)." })
    .where(and(eq(automationRuns.status, "running"), lt(automationRuns.startedAt, new Date(startedAt.getTime() - 30 * 60_000))));

  const [{ id: runId }] = await db
    .insert(automationRuns)
    .values({ kind: "ingest", trigger, startedAt, completedAt: null, status: "running" })
    .returning({ id: automationRuns.id });

  const stats: IngestStats = { fetched: 0, rejected: 0, duplicatesInBatch: 0, unchanged: 0, updated: 0, inserted: 0, mergedIntoStories: 0, newStories: 0 };
  const feedResults: FeedRunResult[] = [];
  const allFeeds = await getFeedSources();
  const feedsById = new Map(allFeeds.map((feed) => [feed.id, feed]));

  try {
    // ── 1–2. Fetch + normalize ───────────────────────────────
    const feeds = allFeeds.filter((f) => !settings.disabledSources.includes(f.id));
    const states = new Map((await db.select().from(feedState).where(inArray(feedState.sourceId, feeds.map((f) => f.id)))).map((s) => [s.sourceId, s]));
    const now = new Date();

    const perFeed = await Promise.all(
      feeds.map(async (feed) => {
        const prev = states.get(feed.id) ?? null;
        const res = await fetchFeed(feed, prev);
        const result: FeedRunResult = { source: feed.id, status: res.status, httpStatus: res.httpStatus, items: 0, ms: res.ms };
        const normalized: NormalizedArticle[] = [];
        if (res.status === "ok") {
          result.items = res.items.length;
          for (const item of res.items.slice(0, 60)) {
            const n = normalizeItem(item, feed, now);
            if (n.ok) normalized.push(n.article);
            else stats.rejected++;
          }
          await db
            .insert(feedState)
            .values({
              sourceId: feed.id,
              etag: res.etag,
              lastModified: res.lastModified,
              lastSuccessAt: now,
              consecutiveFailures: 0,
              lastItemCount: res.items.length,
              lastError: null,
            })
            .onConflictDoUpdate({
              target: feedState.sourceId,
              set: {
                etag: res.etag,
                lastModified: res.lastModified,
                lastSuccessAt: now,
                consecutiveFailures: 0,
                lastItemCount: res.items.length,
                lastError: null,
              },
            });
        } else if (res.status === "not_modified") {
          await db
            .insert(feedState)
            .values({ sourceId: feed.id, lastSuccessAt: now, consecutiveFailures: 0 })
            .onConflictDoUpdate({ target: feedState.sourceId, set: { lastSuccessAt: now, consecutiveFailures: 0 } });
        } else {
          result.error = res.error;
          await db
            .insert(feedState)
            .values({
              sourceId: feed.id,
              lastErrorAt: now,
              lastError: res.error,
              consecutiveFailures: 1,
              etag: null,
              lastModified: null,
              lastSuccessAt: null,
              lastItemCount: 0,
            })
            .onConflictDoUpdate({
              target: feedState.sourceId,
              set: { lastErrorAt: now, lastError: res.error, consecutiveFailures: sql`${feedState.consecutiveFailures} + 1` },
            });
        }
        feedResults.push(result);
        return normalized;
      })
    );

    // ── 3. Compare with previous hours + 4. cluster near-duplicates (pure planning step) ──
    const all = perFeed.flat();
    stats.fetched = all.length;
    const hashes = [...new Set(all.map((a) => a.urlHash))];
    const existingDocs = hashes.length
      ? await db
          .select({ id: articles.id, urlHash: articles.urlHash, contentHash: articles.contentHash, storyId: storyArticles.storyId })
          .from(articles)
          .leftJoin(storyArticles, eq(articles.id, storyArticles.articleId))
          .where(inArray(articles.urlHash, hashes))
      : [];
    const existing = new Map(existingDocs.map((e) => [e.urlHash, { _id: e.id, contentHash: e.contentHash, storyId: e.storyId }]));

    const since = new Date(now.getTime() - CLUSTER_WINDOW_HOURS * 3600_000);
    const recentStories = await db
      .select({ id: stories.id, titleTokens: stories.titleTokens, tokens: stories.tokens, sources: stories.sources, lastPublishedAt: stories.lastPublishedAt, firstPublishedAt: stories.firstPublishedAt })
      .from(stories)
      .where(gte(stories.lastPublishedAt, since));
    const candidates: StoryCandidate[] = recentStories.map((s) => ({
      id: s.id,
      titleTokens: s.titleTokens,
      tokens: s.tokens,
      sources: s.sources,
      lastPublishedAt: s.lastPublishedAt,
      firstPublishedAt: s.firstPublishedAt,
    }));
    const titleHashes = [...new Set(all.map((a) => a.titleHash))];
    const sameTitle = titleHashes.length
      ? await db
          .select({ titleHash: articles.titleHash, storyId: storyArticles.storyId })
          .from(articles)
          .innerJoin(storyArticles, eq(articles.id, storyArticles.articleId))
          .where(and(inArray(articles.titleHash, titleHashes), gte(articles.publishedAt, since)))
      : [];
    const storyByTitleHash = new Map(sameTitle.map((s) => [s.titleHash, s.storyId!]));

    const plan = planIngest({ batch: all, existing, candidates, storyByTitleHash, now, runId });
    stats.duplicatesInBatch = plan.duplicatesInBatch;
    stats.unchanged = plan.unchanged;
    stats.updated = plan.edited.length;
    stats.mergedIntoStories = plan.mergedIntoStories;
    stats.newStories = plan.newStories.length;

    // ── Write ──
    await db.transaction(async (tx) => {
      // Update edited articles
      for (const { id, article: a } of plan.edited) {
        await tx
          .update(articles)
          .set({
            title: a.title,
            titleKey: a.titleKey,
            titleHash: a.titleHash,
            summary: a.summary,
            contentHash: a.contentHash,
            categories: a.categories,
            coins: a.coins,
            updatedAt: now,
            version: sql`${articles.version} + 1`,
          })
          .where(eq(articles.id, id));
      }

      // Articles must exist before stories because stories.primary_article_id is a foreign key.
      const articleIdMap = new Map<string, string>();
      for (const article of plan.newArticles) {
        const [inserted] = await tx
          .insert(articles)
          .values({
            source: article.source,
            guid: article.guid,
            url: article.url,
            canonicalUrl: article.canonicalUrl,
            urlHash: article.urlHash,
            title: article.title,
            titleKey: article.titleKey,
            titleHash: article.titleHash,
            summary: article.summary,
            contentHash: article.contentHash,
            author: article.author,
            publishedAt: article.publishedAt,
            categories: article.categories,
            coins: article.coins,
            rawCategories: article.rawCategories,
            image: article.image,
            fetchedAt: article.fetchedAt,
            updatedAt: article.updatedAt,
            version: article.version,
            firstRunId: article.firstRunId,
          })
          .onConflictDoNothing({ target: articles.urlHash })
          .returning({ id: articles.id });
        if (inserted) {
          articleIdMap.set(article._id!, inserted.id);
          stats.inserted++;
        } else {
          const [existingArticle] = await tx
            .select({ id: articles.id })
            .from(articles)
            .where(eq(articles.urlHash, article.urlHash))
            .limit(1);
          if (!existingArticle) throw new Error(`Article with URL hash ${article.urlHash} disappeared during ingest.`);
          articleIdMap.set(article._id!, existingArticle.id);
        }
      }

      // Resolve plan IDs to persisted IDs before inserting stories and their FK references.
      const storyIdMap = new Map<string, string>();
      for (const story of plan.newStories) {
        const primaryArticleId = articleIdMap.get(story.primaryArticleId);
        if (!primaryArticleId) throw new Error(`Primary article for story "${story.slug}" was not persisted.`);
        const [inserted] = await tx
          .insert(stories)
          .values({
            slug: story.slug,
            title: story.title,
            summary: story.summary,
            primaryArticleId,
            sources: story.sources,
            categories: story.categories,
            coins: story.coins,
            titleTokens: story.titleTokens,
            tokens: story.tokens,
            firstPublishedAt: story.firstPublishedAt,
            lastPublishedAt: story.lastPublishedAt,
            createdAt: story.createdAt,
            updatedAt: story.updatedAt,
            score: story.score,
          })
          .returning({ id: stories.id });
        if (!inserted) throw new Error(`Story "${story.slug}" was not inserted.`);
        storyIdMap.set(story._id!, inserted.id);
      }

      for (const article of plan.newArticles) {
        if (!article.storyId) continue;
        const actualStoryId = storyIdMap.get(article.storyId) ?? article.storyId;
        const actualArticleId = articleIdMap.get(article._id!);
        if (!actualArticleId) throw new Error(`Article "${article.urlHash}" was not persisted.`);
        await tx.insert(storyArticles).values({ storyId: actualStoryId, articleId: actualArticleId }).onConflictDoNothing();
      }

      // Update existing stories with new articles
      for (const [planStoryId, push] of plan.storyPushes) {
        // Use the map for newly created stories, otherwise it's already a real DB ID
        const actualStoryId = storyIdMap.get(planStoryId) ?? planStoryId;

        const storyArticlesIds = await tx
          .select({ articleId: storyArticles.articleId })
          .from(storyArticles)
          .where(eq(storyArticles.storyId, actualStoryId));
        const existingArticleIds = new Set(storyArticlesIds.map((s) => s.articleId));

        // Map plan article IDs to actual DB IDs
        const actualArticleIds = push.articleIds.map(planId => articleIdMap.get(planId) ?? planId);
        const newArticleIds = actualArticleIds.filter((id) => !existingArticleIds.has(id));

        for (const articleId of newArticleIds) {
          await tx.insert(storyArticles).values({ storyId: actualStoryId, articleId }).onConflictDoNothing();
        }

        const story = await tx
          .select({ sources: stories.sources, categories: stories.categories, coins: stories.coins })
          .from(stories)
          .where(eq(stories.id, actualStoryId))
          .limit(1);
        if (story[0]) {
          const mergedSources = [...new Set([...story[0].sources, ...push.sources])];
          const mergedCategories = [...new Set([...story[0].categories, ...push.categories])];
          const mergedCoins = [...new Set([...story[0].coins, ...push.coins])];
          await tx
            .update(stories)
            .set({
              sources: mergedSources,
              categories: mergedCategories,
              coins: mergedCoins,
              lastPublishedAt: push.maxPublished,
              firstPublishedAt: push.minPublished,
              updatedAt: now,
            })
            .where(eq(stories.id, actualStoryId));
        }
      }
    });

    const touchedStoryIds = plan.touchedStoryIds;

    // ── 5. Re-score touched stories + recently active ones (freshness decays) ──
    await rescoreStories([...touchedStoryIds], now);

    // Delta vs the previous hour
    const previous = await db
      .select({ id: automationRuns.id, stats: automationRuns.stats })
      .from(automationRuns)
      .where(and(eq(automationRuns.kind, "ingest"), sql`${automationRuns.id} != ${runId}`, sql`${automationRuns.status} = ANY(ARRAY['success'::text, 'partial'::text])`))
      .orderBy(sql`${automationRuns.startedAt} DESC`)
      .limit(1);
    const failedFeeds = feedResults.filter((f) => f.status === "error").length;
    const status: RunDoc["status"] = failedFeeds === 0 ? "success" : failedFeeds < feeds.length ? "partial" : "failed";
    const deltaVsPrevious = {
      previousRunId: previous[0]?.id ?? null,
      insertedDiff: stats.inserted - ((previous[0]?.stats as { inserted?: number })?.inserted ?? 0),
      newStoriesDiff: stats.newStories - ((previous[0]?.stats as { newStories?: number })?.newStories ?? 0),
    };
    const message = summarize(stats, feedResults, feedsById);
    await db
      .update(automationRuns)
      .set({
        completedAt: new Date(),
        status,
        stats,
        feeds: feedResults.sort((x, y) => x.source.localeCompare(y.source)),
        deltaVsPrevious,
        message,
        error: failedFeeds ? feedResults.filter((f) => f.error).map((f) => `${feedsById.get(f.source)?.name ?? f.source}: ${f.error}`).join(" | ") : null,
      })
      .where(eq(automationRuns.id, runId));
    return { runId, status, message, stats, feeds: feedResults, deltaVsPrevious };
  } catch (err) {
    await db
      .update(automationRuns)
      .set({ completedAt: new Date(), status: "failed", stats, feeds: feedResults, error: err instanceof Error ? err.stack ?? err.message : String(err) })
      .where(eq(automationRuns.id, runId));
    throw err;
  }
}

export async function rescoreStories(ids: string[], now = new Date()) {
  const db = getPostgresDb();
  const since = new Date(now.getTime() - 48 * 3600_000);
  const storyData = await db
    .select({
      id: stories.id,
      title: stories.title,
      sources: stories.sources,
      categories: stories.categories,
      coins: stories.coins,
      lastPublishedAt: stories.lastPublishedAt,
    })
    .from(stories)
    .where(or(inArray(stories.id, ids), gte(stories.lastPublishedAt, since)));

  if (!storyData.length) return;

  // Count articles per story
  const articleCounts = await db
    .select({ storyId: storyArticles.storyId, count: sql<number>`count(*)::int` })
    .from(storyArticles)
    .where(inArray(storyArticles.storyId, storyData.map((s) => s.id)))
    .groupBy(storyArticles.storyId);
  const countMap = new Map(articleCounts.map((c) => [c.storyId, c.count]));

  for (const s of storyData) {
    const articleCount = countMap.get(s.id) ?? 0;
    const newScore = scoreStory({ title: s.title, sources: s.sources, articleCount, categories: s.categories as any, coins: s.coins, lastPublishedAt: s.lastPublishedAt, now });
    await db.update(stories).set({ score: newScore }).where(eq(stories.id, s.id));
  }
}

function summarize(s: IngestStats, feeds: FeedRunResult[], feedsById: Map<string, { name: string }>) {
  const nm = feeds.filter((f) => f.status === "not_modified").length;
  const failed = feeds.filter((f) => f.status === "error").map((f) => feedsById.get(f.source)?.name ?? f.source);
  return `${failed.length ? `${failed.length} feed(s) failed (${failed.join(", ")}). ` : ""}${s.inserted} new, ${s.updated} edited, ${s.unchanged} already seen, ${s.duplicatesInBatch} duplicate in batch, ${s.mergedIntoStories} merged into existing stories, ${s.newStories} new stories${nm ? `, ${nm} feed(s) unchanged since last hour` : ""}.`;
}
