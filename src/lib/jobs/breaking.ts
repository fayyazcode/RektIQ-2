/**
 * Breaking alerts: after every hourly ingest, post the most important NEW story within
 * the hour instead of waiting for the next day's set.
 *
 * A story qualifies when it:
 *   - first appeared in the last 3 hours (so the alert is actually news),
 *   - reaches the importance score for the chosen sensitivity, and
 *   - is confirmed: covered by 2+ newsrooms, or its headline is high-impact (hack,
 *     approval, lawsuit, record high…) where speed matters more than confirmation.
 * Guard rails: at most N alerts per UTC day, a minimum gap between alerts, never the same
 * story twice, and approval mode is respected.
 */
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { getPostgresDb } from "../db/client";
import { stories, outboundPosts, automationRuns, storyArticles } from "../db/schema";
import { SITE } from "../config";
import { getSettings } from "../settings";
import { writePosts } from "../ai/writer";
import { stylesFor } from "../ai/prompt";
import { toCandidate } from "./daily-posts";
import { getFeedSources } from "../feeds/registry";
import { composePost } from "../social/tweet";
import { bufferDryRun, schedulePost } from "../social/buffer";
import { CRITICAL } from "../dedupe/critical";
import type { RunDoc, SettingsDoc, SocialPostDoc, StoryDoc } from "../types";

export const FRESH_HOURS = 3;
export const MIN_SCORE: Record<SettingsDoc["breakingSensitivity"], number> = { strict: 17, normal: 14, relaxed: 11 };

type StoryLite = Pick<StoryDoc, "title" | "sources" | "score" | "firstPublishedAt" | "lastPublishedAt"> & { id: string };

export type BreakingDecision =
  | { pick: StoryLite; reason: string; skipped?: undefined }
  | { pick?: undefined; reason?: undefined; skipped: string };

const hoursAgo = (d: Date, now: Date) => Math.max(0, (now.getTime() - d.getTime()) / 3600_000);

/** Pure decision, so the rules are unit-tested without a database or Buffer. */
export function evaluateBreaking(input: {
  stories: StoryLite[];
  postedStoryIds: Set<string>;
  alertsToday: number;
  lastAlertAt: Date | null;
  settings: Pick<SettingsDoc, "postingEnabled" | "breakingEnabled" | "breakingMaxPerDay" | "breakingMinGapMinutes" | "breakingSensitivity">;
  now: Date;
}): BreakingDecision {
  const { settings: s, now } = input;
  if (!s.postingEnabled || !s.breakingEnabled) return { skipped: "Breaking alerts are turned off in settings." };
  if (input.alertsToday >= s.breakingMaxPerDay) return { skipped: `Today's limit of ${s.breakingMaxPerDay} breaking alert(s) is reached.` };
  if (input.lastAlertAt && now.getTime() - input.lastAlertAt.getTime() < s.breakingMinGapMinutes * 60_000) {
    const next = new Date(input.lastAlertAt.getTime() + s.breakingMinGapMinutes * 60_000);
    return { skipped: `The last alert was under ${s.breakingMinGapMinutes} minutes ago; the next one can go out after ${next.toISOString().slice(11, 16)} UTC.` };
  }

  const minScore = MIN_SCORE[s.breakingSensitivity];
  const qualifying = input.stories
    .filter((st) => !input.postedStoryIds.has(st.id))
    .filter((st) => hoursAgo(st.firstPublishedAt, now) <= FRESH_HOURS)
    // High-impact headlines (hacks, approvals, lawsuits…) need a little less: speed matters more for those.
    .filter((st) => st.score >= minScore - (CRITICAL.test(st.title) ? 3 : 0))
    .filter((st) => {
      const critical = CRITICAL.test(st.title);
      if (s.breakingSensitivity === "strict") return st.sources.length >= 3 || (st.sources.length >= 2 && critical);
      if (s.breakingSensitivity === "normal") return st.sources.length >= 2 || critical;
      return true;
    })
    .sort((a, b) => b.score - a.score);

  const pick = qualifying[0];
  if (!pick) return { skipped: `No new story in the last ${FRESH_HOURS} hours is important enough (${s.breakingSensitivity} sensitivity).` };
  const age = Math.max(1, Math.round(hoursAgo(pick.firstPublishedAt, now) * 60));
  const coverage = pick.sources.length > 1 ? `covered by ${pick.sources.length} newsrooms` : "single newsroom";
  const impact = CRITICAL.test(pick.title) ? `, high-impact headline ("${pick.title.match(CRITICAL)![0]}")` : "";
  return { pick, reason: `${coverage}${impact}, first reported ${age < 60 ? `${age} min` : `${Math.round(age / 60)} h`} ago, score ${pick.score}` };
}

const utcDayStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

export async function runBreakingAlerts(trigger: RunDoc["trigger"] = "schedule") {
  const db = getPostgresDb();
  const settings = await getSettings();
  const now = new Date();

  if (process.env.GITHUB_ACTIONS && /localhost|127\.0\.0\.1/.test(SITE.url)) {
    const message = "Breaking alerts skipped: the SITE_URL variable isn't set in GitHub, so post links would point to localhost.";
    const [{ id: runId }] = await db
      .insert(automationRuns)
      .values({ kind: "breaking", trigger, startedAt: now, completedAt: now, status: "skipped", message })
      .returning({ id: automationRuns.id });
    return { runId, status: "skipped" as const, message };
  }

  const [storiesData, recentPosts, alertsTodayCount, lastAlert] = await Promise.all([
    db
      .select({ id: stories.id, title: stories.title, summary: stories.summary, slug: stories.slug, sources: stories.sources, score: stories.score, firstPublishedAt: stories.firstPublishedAt, lastPublishedAt: stories.lastPublishedAt, aiSummary: stories.aiSummary })
      .from(stories)
      .where(gte(stories.firstPublishedAt, new Date(now.getTime() - FRESH_HOURS * 3600_000)))
      .orderBy(sql`${stories.score} DESC`)
      .limit(20),
    db
      .select({ storyId: outboundPosts.storyId })
      .from(outboundPosts)
      .where(and(gte(outboundPosts.createdAt, new Date(now.getTime() - 3 * 86400_000)), sql`${outboundPosts.storyId} IS NOT NULL`)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(outboundPosts)
      .where(and(eq(outboundPosts.origin, "breaking"), gte(outboundPosts.createdAt, utcDayStart(now)), sql`${outboundPosts.status} != 'rejected'`)),
    db
      .select({ createdAt: outboundPosts.createdAt })
      .from(outboundPosts)
      .where(and(eq(outboundPosts.origin, "breaking"), sql`${outboundPosts.status} != 'rejected'`))
      .orderBy(sql`${outboundPosts.createdAt} DESC`)
      .limit(1),
  ]);

  const alertsToday = alertsTodayCount[0]?.count ?? 0;
  const decision = evaluateBreaking({
    stories: storiesData.map((s) => ({ id: s.id, title: s.title, sources: s.sources, score: s.score, firstPublishedAt: s.firstPublishedAt, lastPublishedAt: s.lastPublishedAt })),
    postedStoryIds: new Set(recentPosts.map((p) => p.storyId!).filter(Boolean)),
    alertsToday,
    lastAlertAt: lastAlert[0]?.createdAt ?? null,
    settings,
    now,
  });

  if (!decision.pick) {
    // Quiet hours are normal; record them only as a short skipped run so Runs stays readable.
    const [{ id: runId }] = await db
      .insert(automationRuns)
      .values({ kind: "breaking", trigger, startedAt: now, completedAt: new Date(), status: "skipped", message: decision.skipped })
      .returning({ id: automationRuns.id });
    return { runId, status: "skipped" as const, message: decision.skipped };
  }

  const story = storiesData.find((s) => s.id === decision.pick.id)!;
  const [{ id: runId }] = await db
    .insert(automationRuns)
    .values({ kind: "breaking", trigger, startedAt: now, completedAt: null, status: "running" })
    .returning({ id: automationRuns.id });
  try {
    // Alerts are never jokes. They alternate between a complete no-link post and a link post,
    // following the mix's link/detailed balance.
    const style = stylesFor(alertsToday + 1, { ...settings.postMix, humor: 0 })[alertsToday] ?? "detailed";
    const feeds = await getFeedSources();
    // Build a minimal StoryDoc for toCandidate
    const storyForCandidate: StoryDoc = {
      _id: story.id,
      slug: story.slug,
      title: story.title,
      summary: story.summary,
      primaryArticleId: "", // Will be populated if needed
      articleIds: [],
      sources: story.sources,
      categories: [],
      coins: [],
      titleTokens: [],
      tokens: [],
      firstPublishedAt: story.firstPublishedAt,
      lastPublishedAt: story.lastPublishedAt,
      createdAt: new Date(),
      updatedAt: new Date(),
      score: story.score,
      aiSummary: story.aiSummary ? { ...story.aiSummary, at: new Date(story.aiSummary.at), writtenBy: story.aiSummary.writtenBy as "gemini" | "groq" } : null,
    };
    const { posts, writtenBy, errors } = await writePosts([toCandidate(storyForCandidate, feeds)], [{ kind: "breaking", style }]);
    const post = posts[0] ?? { text: story.title, style: "link" as const };
    const content = composePost(post.text, post.style === "link" ? `${SITE.url}/story/${story.slug}` : null);
    const dry = bufferDryRun();
    const doc: SocialPostDoc = {
      storyId: story.id,
      content,
      kind: "breaking",
      platform: "x",
      status: settings.requireApproval ? "pending_approval" : dry ? "dry_run" : "scheduled",
      bufferPostId: null,
      scheduledAt: now,
      createdAt: now,
      updatedAt: now,
      error: null,
      writtenBy,
      runId,
      origin: "breaking",
      style: post.style,
      reason: decision.reason,
    };
    if (doc.status === "scheduled") {
      try {
        doc.bufferPostId = (await schedulePost(content, "now")).id;
      } catch (err) {
        doc.status = "failed";
        doc.error = err instanceof Error ? err.message : String(err);
      }
    }
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
      origin: doc.origin,
      reason: doc.reason,
      style: doc.style,
    });

    const verb = doc.status === "scheduled" ? "sent to Buffer to publish now" : doc.status === "pending_approval" ? "waiting for approval" : doc.status === "dry_run" ? "saved (dry run, not sent)" : "failed to send";
    const message = `Breaking alert ${verb}: "${story.title}" (${decision.reason}).`;
    const status: RunDoc["status"] = doc.status === "failed" ? "failed" : "success";
    await db
      .update(automationRuns)
      .set({ completedAt: new Date(), status, postsCreated: 1, message, error: [...errors, doc.error].filter(Boolean).join(" | ") || null })
      .where(eq(automationRuns.id, runId));
    return { runId, status, message, post: { status: doc.status, content: doc.content, error: doc.error } };
  } catch (err) {
    await db
      .update(automationRuns)
      .set({ completedAt: new Date(), status: "failed", error: err instanceof Error ? err.stack ?? err.message : String(err) })
      .where(eq(automationRuns.id, runId));
    throw err;
  }
}
