import "server-only";
import { unstable_cache } from "next/cache";
import { cache } from "react";
import { sql, eq, and, gte, lte, desc, asc, isNotNull, isNull, inArray, like, or, ne } from "drizzle-orm";
import { getPostgresDb } from "../db/client";
import * as schema from "../db/schema";
import { RETENTION_DAYS, retentionCutoff } from "../config";
import { detectCoins } from "../normalize/categories";
import type { ArticleDoc, ArticleView, Category, PostStatus, PostView, RunDoc, SocialPostDoc, StoryDoc, StoryView } from "../types";

export const toStoryView = (s: typeof schema.stories.$inferSelect): StoryView => ({
  id: s.id,
  slug: s.slug,
  title: s.title,
  summary: s.summary,
  sources: s.sources,
  categories: s.categories as Category[],
  coins: s.coins,
  firstPublishedAt: s.firstPublishedAt.toISOString(),
  lastPublishedAt: s.lastPublishedAt.toISOString(),
  score: s.score,
  articleCount: 0,
  aiSummary: s.aiSummary
    ? { whatHappened: s.aiSummary.whatHappened, whyItMatters: s.aiSummary.whyItMatters, keyFacts: s.aiSummary.keyFacts, sourceCount: s.aiSummary.sourceCount, at: new Date(s.aiSummary.at).toISOString() }
    : null,
});

export const toArticleView = (a: typeof schema.articles.$inferSelect): ArticleView => ({
  id: a.id,
  source: a.source,
  title: a.title,
  summary: a.summary,
  url: a.url,
  author: a.author,
  publishedAt: a.publishedAt.toISOString(),
  updatedAt: a.updatedAt.toISOString(),
  version: a.version,
});

const STORY_LIST_PROJECTION = { tokens: 0, titleTokens: 0 } as const;

export const NEWS_TAG = "news";
const QUERY_TIMEOUT_MS = 8_000;

const queryHealth = cache(() => ({ failed: false, succeeded: false, reason: "" }));
export const databaseUnavailable = () => {
  const health = queryHealth();
  return health.failed && !health.succeeded;
};

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Database query timed out after ${ms / 1000}s`)), ms);
    p.then((v) => (clearTimeout(t), resolve(v)), (e) => (clearTimeout(t), reject(e)));
  });
}

function publicQuery<A extends unknown[], R>(key: string, revalidate: number, fallback: R, fn: (...args: A) => Promise<R>) {
  const cached = unstable_cache(fn, [key], { revalidate, tags: [NEWS_TAG] });
  return cache(async (...args: A): Promise<R> => {
    if (!process.env.DATABASE_URL) return fallback;
    try {
      const result = await withTimeout(cached(...args), queryHealth().failed ? 1_500 : QUERY_TIMEOUT_MS);
      queryHealth().succeeded = true;
      return result;
    } catch (err) {
      const f = queryHealth();
      f.failed = true;
      f.reason = err instanceof Error ? err.message : String(err);
      console.error(`[queries:${key}]`, f.reason);
      return fallback;
    }
  });
}

export const getTopStories = publicQuery("top-stories", 300, [] as StoryView[], async (limit: number = 6, hours: number = 24) => {
  const db = getPostgresDb();
  const since = new Date(Date.now() - hours * 3600_000);
  let docs = await db
    .select()
    .from(schema.stories)
    .where(gte(schema.stories.lastPublishedAt, since))
    .orderBy(desc(schema.stories.score))
    .limit(limit);

  if (docs.length < limit) {
    docs = await db
      .select()
      .from(schema.stories)
      .where(gte(schema.stories.lastPublishedAt, retentionCutoff()))
      .orderBy(desc(schema.stories.score), desc(schema.stories.lastPublishedAt))
      .limit(limit);
  }
  return docs.map(toStoryView);
});

export type StoryRange = "1d" | "7d" | "30d";
export const RANGES: { id: StoryRange; label: string; days: number }[] = [
  { id: "1d", label: "Past 24 hours", days: 1 },
  { id: "7d", label: "Past 7 days", days: 7 },
  { id: "30d", label: `Past ${RETENTION_DAYS} days`, days: RETENTION_DAYS },
];

export type StoryQuery = { category?: Category; source?: string; coin?: string; q?: string; range?: StoryRange; page?: number; perPage?: number; withTotal?: boolean };

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function searchFilter(q: string): ReturnType<typeof and> | undefined {
  const terms = q.toLowerCase().split(/\s+/).map((t) => t.replace(/[^\p{L}\p{N}$%.-]/gu, "")).filter((t) => t.length >= 2).slice(0, 6);
  if (!terms.length) return undefined;

  const conditions = terms.map((t) => {
    const coins = [...new Set([t.toUpperCase().replace(/^\$/, ""), ...detectCoins(t)])];
    return or(
      like(schema.stories.title, `%${t}%`),
      like(schema.stories.summary, `%${t}%`),
      ...coins.map((coin) => sql`${schema.stories.coins} @> ARRAY[${coin}]::text[]`)
    );
  });

  return and(...conditions);
}

export const getStories = publicQuery(
  "stories",
  300,
  { items: [] as StoryView[], total: 0, page: 1, pages: 1 },
  async (query: StoryQuery) => {
    const db = getPostgresDb();
    const perPage = Math.min(50, query.perPage ?? 25);
    const page = Math.max(1, query.page ?? 1);
    const days = RANGES.find((r) => r.id === query.range)?.days ?? RETENTION_DAYS;
    const since = new Date(Date.now() - days * 86400_000);
    let filter = gte(schema.stories.lastPublishedAt, since);

    if (query.category) filter = and(filter, sql`${query.category} = ANY(${schema.stories.categories})`)!;
    if (query.source) filter = and(filter, sql`${query.source} = ANY(${schema.stories.sources})`)!;
    if (query.coin) filter = and(filter, sql`${query.coin.toUpperCase()} = ANY(${schema.stories.coins})`)!;
    if (query.q?.trim()) {
      const searchCond = searchFilter(query.q.trim().slice(0, 100));
      filter = and(filter, searchCond)!;
    }

    const [docs, total] = await Promise.all([
      db
        .select()
        .from(schema.stories)
        .where(filter)
        .orderBy(desc(schema.stories.lastPublishedAt))
        .offset((page - 1) * perPage)
        .limit(perPage),
      query.withTotal === false ? Promise.resolve(0) : db
        .select({ count: sql<number>`count(*)` })
        .from(schema.stories)
        .where(filter)
    ]);

    const totalCount = typeof total === "number" ? total : Number(total[0]?.count ?? 0);
    return {
      items: docs.map(toStoryView),
      total: totalCount,
      page,
      pages: Math.max(1, Math.ceil(totalCount / perPage))
    };
  }
);

export const getStoryBySlug = publicQuery("story", 600, null as { story: StoryView; articles: ArticleView[] } | null, async (slug: string) => {
  const db = getPostgresDb();
  const story = await db
    .select()
    .from(schema.stories)
    .where(and(eq(schema.stories.slug, slug), gte(schema.stories.lastPublishedAt, retentionCutoff())))
    .limit(1);

  if (!story.length) return null;
  const storyObj = story[0];

  const arts = await db
    .select()
    .from(schema.storyArticles)
    .innerJoin(schema.articles, eq(schema.storyArticles.articleId, schema.articles.id))
    .where(eq(schema.storyArticles.storyId, storyObj.id))
    .orderBy(asc(schema.articles.publishedAt));

  return { story: toStoryView(storyObj), articles: arts.map(({ articles }) => toArticleView(articles)) };
});

export const getRelatedStories = publicQuery("related", 600, [] as StoryView[], async (storyId: string, categories: Category[], limit: number = 5) => {
  if (!categories.length) return [];
  const db = getPostgresDb();
  const docs = await db
    .select()
    .from(schema.stories)
    .where(
      and(
        sql`${schema.stories.id} != ${storyId}`,
        or(...categories.map((category) => sql`${schema.stories.categories} @> ARRAY[${category}]::text[]`)),
        gte(schema.stories.lastPublishedAt, new Date(Date.now() - 7 * 86400_000))
      )
    )
    .orderBy(desc(schema.stories.score))
    .limit(limit);
  return docs.map(toStoryView);
});

export async function toPostViews(docs: typeof schema.outboundPosts.$inferSelect[]): Promise<PostView[]> {
  const db = getPostgresDb();
  const ids = docs.map((d) => d.storyId).filter((x): x is any => Boolean(x));
  const s = ids.length ? await db
    .select({ id: schema.stories.id, slug: schema.stories.slug, title: schema.stories.title })
    .from(schema.stories)
    .where(inArray(schema.stories.id, ids))
    : [];
  const byId = new Map(s.map((x) => [x.id.toString(), x]));
  return docs.map((d) => {
    const st = d.storyId ? byId.get(d.storyId.toString()) : undefined;
    return {
      id: d.id,
      content: d.content,
      kind: d.kind as "breaking" | "market" | "insight" | "other",
      status: d.status as "pending_approval" | "scheduled" | "sent" | "failed" | "rejected" | "dry_run",
      scheduledAt: d.scheduledAt.toISOString(),
      createdAt: d.createdAt.toISOString(),
      error: d.error,
      writtenBy: d.writtenBy as "buffer" | "gemini" | "groq" | "rules" | "manual",
      origin: d.origin as "buffer" | "breaking" | "manual" | "daily" | null | undefined,
      sentAt: d.sentAt ? d.sentAt.toISOString() : null,
      externalUrl: d.externalUrl ?? null,
      storySlug: st?.slug ?? null,
      storyTitle: st?.title ?? null,
      style: d.style as "link" | "detailed" | "humor" | null,
      reason: d.reason ?? null,
    };
  });
}

export const getPublicPosts = publicQuery("public-posts", 600, [] as PostView[], async (limit: number = 30) => {
  const db = getPostgresDb();
  const docs = await db
    .select()
    .from(schema.outboundPosts)
    .where(
      and(
        inArray(schema.outboundPosts.status, ["scheduled", "sent"]),
        gte(schema.outboundPosts.scheduledAt, retentionCutoff())
      )
    )
    .orderBy(desc(schema.outboundPosts.scheduledAt))
    .limit(limit);
  return toPostViews(docs);
});

export const getLastIngest = publicQuery("last-ingest", 300, null as { at: string | null; message: string | null } | null, async () => {
  const db = getPostgresDb();
  const r = await db
    .select()
    .from(schema.automationRuns)
    .where(
      and(
        inArray(schema.automationRuns.status, ["success", "partial"]),
        eq(schema.automationRuns.kind, "ingest")
      )
    )
    .orderBy(desc(schema.automationRuns.startedAt))
    .limit(1);

  return r.length ? { at: r[0].completedAt?.toISOString() ?? null, message: r[0].message ?? null } : null;
});

export const countStoriesSince = publicQuery("live-count", 30, 0, async (sinceIso: string) => {
  const db = getPostgresDb();
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.stories)
    .where(gte(schema.stories.createdAt, new Date(sinceIso)));
  return Number(result[0]?.count ?? 0);
});

export const getSourceCounts = publicQuery("source-counts", 900, {} as Record<string, number>, async (hours: number = 24) => {
  const db = getPostgresDb();
  const rows = await db
    .select({ _id: schema.articles.source, n: sql<number>`count(*)` })
    .from(schema.articles)
    .where(gte(schema.articles.publishedAt, new Date(Date.now() - hours * 3600_000)))
    .groupBy(schema.articles.source);

  return Object.fromEntries(rows.map((r) => [r._id, Number(r.n)]));
});

export const getSitemapStories = publicQuery("sitemap", 900, [] as { slug: string; lastPublishedAt: string; title: string }[], async () => {
  const db = getPostgresDb();
  const docs = await db
    .select()
    .from(schema.stories)
    .where(gte(schema.stories.lastPublishedAt, retentionCutoff()))
    .orderBy(desc(schema.stories.lastPublishedAt))
    .limit(10000);

  return docs.map((d) => ({ slug: d.slug, title: d.title, lastPublishedAt: d.lastPublishedAt.toISOString() }));
});

/* ── Admin ───────────────────────────────────────────── */

export async function getRuns(kind?: typeof schema.automationRuns.$inferSelect["kind"], limit = 30) {
  const db = getPostgresDb();
  const filter = kind ? eq(schema.automationRuns.kind, kind) : undefined;
  return await db
    .select()
    .from(schema.automationRuns)
    .where(filter)
    .orderBy(desc(schema.automationRuns.startedAt))
    .limit(limit);
}

export async function getFeedStates() {
  const db = getPostgresDb();
  return await db.select().from(schema.feedState);
}

export async function getAdminPosts(status?: typeof schema.outboundPosts.$inferSelect["status"], limit = 60) {
  const db = getPostgresDb();
  const filter = status ? eq(schema.outboundPosts.status, status) : undefined;
  const docs = await db
    .select()
    .from(schema.outboundPosts)
    .where(filter)
    .orderBy(asc(schema.outboundPosts.createdAt), asc(schema.outboundPosts.scheduledAt))
    .limit(limit);
  return toPostViews(docs);
}

export async function getAdminStats() {
  const db = getPostgresDb();
  const day = new Date(Date.now() - 86400_000);
  const since = day.toISOString();
  const [stats] = await db.execute(sql<{
    articles24: number;
    stories24: number;
    multiSource24: number;
    pending: number;
    failedRuns24: number;
    oldestStory: Date | string | null;
    lastCleanup: Date | string | null;
  }>`
    SELECT
      (SELECT count(*) FROM ${schema.articles} WHERE ${schema.articles.fetchedAt} >= ${since}::timestamptz) AS "articles24",
      (SELECT count(*) FROM ${schema.stories} WHERE ${schema.stories.createdAt} >= ${since}::timestamptz) AS "stories24",
      (SELECT count(*) FROM ${schema.stories} WHERE ${schema.stories.lastPublishedAt} >= ${since}::timestamptz AND array_length(${schema.stories.sources}, 1) IS NOT NULL) AS "multiSource24",
      (SELECT count(*) FROM ${schema.outboundPosts} WHERE ${schema.outboundPosts.status} = 'pending_approval') AS pending,
      (SELECT count(*) FROM ${schema.automationRuns} WHERE ${schema.automationRuns.startedAt} >= ${since}::timestamptz AND ${schema.automationRuns.status} = 'failed') AS "failedRuns24",
      (SELECT min(${schema.stories.lastPublishedAt}) FROM ${schema.stories}) AS "oldestStory",
      (SELECT ${schema.automationRuns.startedAt} FROM ${schema.automationRuns} WHERE ${schema.automationRuns.kind} = 'cleanup' AND ${schema.automationRuns.status} = 'success' ORDER BY ${schema.automationRuns.startedAt} DESC LIMIT 1) AS "lastCleanup"
  `);

  return {
    articles24: Number(stats?.articles24 ?? 0),
    stories24: Number(stats?.stories24 ?? 0),
    multiSource24: Number(stats?.multiSource24 ?? 0),
    pending: Number(stats?.pending ?? 0),
    failedRuns24: Number(stats?.failedRuns24 ?? 0),
    oldestStory: databaseDate(stats?.oldestStory),
    lastCleanup: databaseDate(stats?.lastCleanup),
  };
}

function databaseDate(value: unknown): Date | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : typeof value === "string" ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) throw new Error("PostgreSQL returned an invalid timestamp.");
  return date;
}
