/**
 * Daily posting job: shortlist → AI writes 3 posts → Buffer (or approval queue).
 */
import { and, eq, gte, inArray, lt, notInArray, or, sql } from "drizzle-orm";
import { getPostgresDb } from "../db/client";
import { stories, outboundPosts, automationRuns, storyArticles } from "../db/schema";
import { SITE, feedById } from "../config";
import { getSettings } from "../settings";
import { getFeedSources } from "../feeds/registry";
import { writePosts } from "../ai/writer";
import { kindsFor, stylesFor, type Candidate, type PostRequest } from "../ai/prompt";
import { composePost } from "../social/tweet";
import { bufferDryRun, schedulePost } from "../social/buffer";
import type { FeedSource, RunDoc, SettingsDoc, SocialPostDoc, StoryDoc } from "../types";

/** The AI summary (when there is one) gives the post writer more, verified detail to work with. */
export const toCandidate = (st: Pick<StoryDoc, "title" | "summary" | "sources" | "lastPublishedAt" | "aiSummary">, feeds: FeedSource[] = []): Candidate => ({
  title: st.title,
  summary: st.aiSummary?.whatHappened ?? st.summary,
  sources: st.sources,
  sourceNames: st.sources.map((id) => feeds.find((feed) => feed.id === id)?.name ?? feedById(id)?.name ?? id),
  publishedAt: st.lastPublishedAt,
  facts: st.aiSummary ? [...st.aiSummary.keyFacts, st.aiSummary.whyItMatters].filter(Boolean) : undefined,
});

const utcDayStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/**
 * Today's send slots (UTC). Uses the exact times when there are at least as many as
 * posts per day; otherwise spreads the posts evenly across the posting window.
 */
export function daySlots(
  s: Pick<SettingsDoc, "postsPerDay" | "postTimesUtc" | "postWindowStartUtc" | "postWindowEndUtc">,
  day: Date
): Date[] {
  const count = Math.min(24, Math.max(1, Math.round(s.postsPerDay)));
  const base = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
  const times = [...new Set(s.postTimesUtc.filter((t) => TIME_RE.test(t)))].sort();
  let minutes: number[];
  if (times.length >= count) {
    minutes = times.slice(0, count).map(toMinutes);
  } else {
    let start = TIME_RE.test(s.postWindowStartUtc) ? toMinutes(s.postWindowStartUtc) : 8 * 60;
    let end = TIME_RE.test(s.postWindowEndUtc) ? toMinutes(s.postWindowEndUtc) : 22 * 60;
    if (end <= start) [start, end] = [8 * 60, 22 * 60];
    const step = (end - start) / count;
    minutes = Array.from({ length: count }, (_, i) => Math.round(start + step * (i + 0.5)));
  }
  return minutes.map((m) => new Date(base + m * 60_000));
}

/** How far ahead each run writes posts. Covers the gap until the next run (every 2 hours) with room to spare. */
export const LOOKAHEAD_MIN = 150;
/** Minimum time between two posts written in the same run. */
export const MIN_SPACING_MIN = 15;
/** A slot missed by up to this much (a late or skipped run) is still posted, right away. */
export const GRACE_MIN = 60;

/** Which of today's slots this run should fill. */
export function dueSlots(slots: Date[], filled: Set<string>, now: Date, force = false): Date[] {
  const open = slots.filter((d) => !filled.has(d.toISOString()) && d.getTime() >= now.getTime() - GRACE_MIN * 60_000);
  if (force) return open.length ? open : [new Date(now.getTime() + 5 * 60_000)];
  return open.filter((d) => d.getTime() <= now.getTime() + LOOKAHEAD_MIN * 60_000);
}

/** Up to 10 recent high-scoring stories, skipping ones posted in the last 3 days. */
async function shortlist(now: Date): Promise<StoryDoc[]> {
  const db = getPostgresDb();
  const recentPosted = await db
    .select({ storyId: outboundPosts.storyId })
    .from(outboundPosts)
    .where(and(gte(outboundPosts.createdAt, new Date(now.getTime() - 3 * 86400_000)), sql`${outboundPosts.storyId} IS NOT NULL`));
  const exclude = new Set(recentPosted.map((p) => p.storyId!).filter(Boolean));
  for (const hours of [24, 48]) {
    const excludeCondition = exclude.size > 0 ? notInArray(stories.id, Array.from(exclude)) : undefined;
    const storiesData = await db
      .select()
      .from(stories)
      .where(excludeCondition ? and(gte(stories.lastPublishedAt, new Date(now.getTime() - hours * 3600_000)), excludeCondition) : gte(stories.lastPublishedAt, new Date(now.getTime() - hours * 3600_000)))
      .orderBy(sql`${stories.score} DESC, ${stories.lastPublishedAt} DESC`)
      .limit(10);
    if (storiesData.length >= 5 || hours === 48) {
      // Convert to StoryDoc format with articleIds
      const storyIds = storiesData.map((s) => s.id);
      const articleData = await db
        .select({ storyId: storyArticles.storyId, articleId: storyArticles.articleId })
        .from(storyArticles)
        .where(inArray(storyArticles.storyId, storyIds));
      const articleMap = new Map<string, string[]>();
      for (const row of articleData) {
        if (!articleMap.has(row.storyId)) articleMap.set(row.storyId, []);
        articleMap.get(row.storyId)!.push(row.articleId);
      }
      return storiesData.map((s) => {
        const storyDoc: StoryDoc = {
          _id: s.id,
          slug: s.slug,
          title: s.title,
          summary: s.summary,
          primaryArticleId: s.primaryArticleId,
          articleIds: articleMap.get(s.id) ?? [],
          sources: s.sources,
          categories: s.categories as any,
          coins: s.coins,
          titleTokens: s.titleTokens,
          tokens: s.tokens,
          firstPublishedAt: s.firstPublishedAt,
          lastPublishedAt: s.lastPublishedAt,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
          score: s.score,
          aiSummary: s.aiSummary ? { ...s.aiSummary, at: new Date(s.aiSummary.at), writtenBy: s.aiSummary.writtenBy as "gemini" | "groq" } : null,
        };
        return storyDoc;
      });
    }
  }
  return [];
}

/**
 * Rolling posting job. Runs often (every 2 hours by default) and each time writes posts only
 * for the day's slots coming up in the next 2½ hours, from the freshest top stories. A slot
 * missed by a late run is still filled within an hour. `force` fills every remaining slot now.
 */
export async function runDailyPosts(opts: { trigger?: RunDoc["trigger"]; force?: boolean } = {}) {
  const db = getPostgresDb();
  const settings = await getSettings();
  const now = new Date();
  const trigger = opts.trigger ?? "schedule";

  if (!settings.postingEnabled && !opts.force) {
    const message = "Posting is turned off in settings.";
    const [{ id: runId }] = await db
      .insert(automationRuns)
      .values({ kind: "daily_posts", trigger, startedAt: now, completedAt: now, status: "skipped", message })
      .returning({ id: automationRuns.id });
    return { runId, status: "skipped" as const, message };
  }

  const slots = daySlots(settings, now);
  const todays = await db
    .select({ slotKey: outboundPosts.slotKey })
    .from(outboundPosts)
    .where(and(eq(outboundPosts.origin, "daily"), sql`${outboundPosts.slotKey} IS NOT NULL`, gte(outboundPosts.createdAt, utcDayStart(now))));
  const filled = new Set(todays.map((p) => p.slotKey!));
  const due = dueSlots(slots, filled, now, opts.force);
  const doneCount = slots.filter((d) => filled.has(d.toISOString())).length;

  if (!due.length) {
    const next = slots.find((d) => !filled.has(d.toISOString()) && d > now);
    const message = `Nothing due: ${doneCount} of ${slots.length} posts done today${next ? `, next slot ${next.toISOString().slice(11, 16)} UTC` : ", no slots left today"}.`;
    // Frequent no-op runs aren't stored, to keep Runs readable.
    return { runId: null, status: "skipped" as const, message };
  }

  const [{ id: runId }] = await db
    .insert(automationRuns)
    .values({ kind: "daily_posts", trigger, startedAt: now, completedAt: null, status: "running" })
    .returning({ id: automationRuns.id });
  try {
    const stories = await shortlist(now);
    if (!stories.length) {
      const message = "No stories from the last 48 hours to write about, so no posts were created. Run the ingest first (Admin → Check feeds now) and check Runs for feed errors.";
      await db
        .update(automationRuns)
        .set({ completedAt: new Date(), status: "failed", postsCreated: 0, message, error: message })
        .where(eq(automationRuns.id, runId));
      return { runId, status: "failed" as const, message, posts: [] };
    }
    // Type and style follow the slot's position in the day: types cycle breaking → market →
    // insight; styles (link / detailed / humor) are spread across the day by the mix in settings.
    const dayStyles = stylesFor(slots.length, settings.postMix);
    const requests: PostRequest[] = due.map((d) => {
      const idx = Math.max(0, slots.findIndex((x) => x.getTime() === d.getTime()));
      return { kind: kindsFor(idx + 1)[idx], style: dayStyles[idx] ?? "link" };
    });
    const feeds = await getFeedSources();
    const { posts, writtenBy, errors } = await writePosts(stories.map((story) => toCandidate(story, feeds)), requests);
    const dry = bufferDryRun();

    const docs: SocialPostDoc[] = [];
    let previous = 0;
    for (const [i, p] of posts.entries()) {
      const story = stories[p.storyIndex];
      const slot = due[i];
      // At its slot, but never in the past, and at least MIN_SPACING after the previous post,
      // so slots caught up after a late run don't all go out in the same minute.
      const sendAt = new Date(Math.max(slot.getTime(), now.getTime() + 5 * 60_000, previous ? previous + MIN_SPACING_MIN * 60_000 : 0));
      previous = sendAt.getTime();
      // Only link posts carry the website link; detailed and humor posts stand on their own.
      const content = composePost(p.text, p.style === "link" ? `${SITE.url}/story/${story.slug}` : null);
      const doc: SocialPostDoc = {
        style: p.style,
        storyId: story._id!,
        content,
        kind: p.kind,
        platform: "x",
        status: settings.requireApproval ? "pending_approval" : dry ? "dry_run" : "scheduled",
        bufferPostId: null,
        scheduledAt: sendAt,
        createdAt: new Date(),
        updatedAt: new Date(),
        error: null,
        writtenBy,
        runId,
        origin: "daily",
        slotKey: slot.toISOString(),
      };
      if (doc.status === "scheduled") {
        try {
          doc.bufferPostId = (await schedulePost(content, sendAt)).id;
        } catch (err) {
          doc.status = "failed";
          doc.error = err instanceof Error ? err.message : String(err);
        }
      }
      docs.push(doc);
    }
    if (docs.length) {
      for (const doc of docs) {
        await db.insert(outboundPosts).values({
          storyId: doc.storyId,
          content: doc.content,
          kind: doc.kind,
          platform: doc.platform,
          status: doc.status,
          bufferPostId: doc.bufferPostId,
          scheduledAt: doc.scheduledAt,
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt,
          error: doc.error,
          writtenBy: doc.writtenBy,
          runId: doc.runId,
          sentAt: doc.sentAt,
          externalUrl: doc.externalUrl,
          lastSyncedAt: doc.lastSyncedAt,
          origin: doc.origin,
          reason: doc.reason,
          slotKey: doc.slotKey,
          style: doc.style,
        });
      }
    }

    const failed = docs.filter((d) => d.status === "failed").length;
    const status: RunDoc["status"] = docs.length === 0 ? "failed" : failed ? "partial" : "success";
    const times = docs.map((d) => d.scheduledAt.toISOString().slice(11, 16)).join(", ");
    const message = `${docs.length} post(s) written by ${writtenBy} for ${times} UTC (${doneCount + docs.length} of ${slots.length} today)${settings.requireApproval ? ", waiting for approval" : dry ? ", dry run, not sent" : ""}.`;
    const errorText = [...errors, ...docs.filter((d) => d.error).map((d) => d.error!)].join(" | ") || null;
    await db
      .update(automationRuns)
      .set({ completedAt: new Date(), status, postsCreated: docs.length - failed, message, error: errorText })
      .where(eq(automationRuns.id, runId));
    return { runId, status, message, writtenBy, posts: docs.map((d) => ({ kind: d.kind, status: d.status, scheduledAt: d.scheduledAt, content: d.content, error: d.error })) };
  } catch (err) {
    await db
      .update(automationRuns)
      .set({ completedAt: new Date(), status: "failed", error: err instanceof Error ? err.stack ?? err.message : String(err) })
      .where(eq(automationRuns.id, runId));
    throw err;
  }
}

/** Sends an approved (or previously failed) post to Buffer. */
export async function sendPost(postId: string, content?: string) {
  const db = getPostgresDb();
  const posts = await db.select().from(outboundPosts).where(eq(outboundPosts.id, postId)).limit(1);
  const post = posts[0];
  if (!post) throw new Error("Post not found");
  if (post.status === "scheduled" || post.status === "sent") throw new Error(`This post is already ${post.status}`);
  const source = content ?? post.content;
  const link = source.match(/https?:\/\/\S+/)?.[0] ?? post.content.match(/https?:\/\/\S+/)?.[0] ?? null;
  const text = composePost(source, link);
  const now = new Date();
  // Breaking alerts go out immediately; everything else keeps its slot (or goes in 5 minutes if the slot passed).
  const when = post.origin === "breaking" ? ("now" as const) : post.scheduledAt.getTime() > now.getTime() + 5 * 60_000 ? post.scheduledAt : new Date(now.getTime() + 5 * 60_000);
  const dueAt = when === "now" ? now : when;
  if (bufferDryRun()) {
    await db
      .update(outboundPosts)
      .set({ content: text, status: "dry_run", scheduledAt: dueAt, updatedAt: now, error: null })
      .where(eq(outboundPosts.id, postId));
    return { status: "dry_run" as const };
  }
  try {
    const { id } = await schedulePost(text, when);
    await db
      .update(outboundPosts)
      .set({ content: text, status: "scheduled", bufferPostId: id, scheduledAt: dueAt, updatedAt: now, error: null })
      .where(eq(outboundPosts.id, postId));
    return { status: "scheduled" as const };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db.update(outboundPosts).set({ content: text, status: "failed", updatedAt: now, error: msg }).where(eq(outboundPosts.id, postId));
    throw err;
  }
}
