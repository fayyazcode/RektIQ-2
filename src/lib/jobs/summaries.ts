/**
 * AI summaries for major stories, written right after each ingest. Major = covered by 2+
 * newsrooms, high-scoring, or a high-impact headline. A summary is refreshed once more
 * newsrooms join the story. Capped per run and per day to stay inside free AI limits.
 */
import { and, eq, gte, sql } from "drizzle-orm";
import { getPostgresDb } from "../db/client";
import { stories, articles as articleTable, automationRuns, storyArticles } from "../db/schema";
import { getSettings } from "../settings";
import { hasSecret } from "../env";
import { summarizeStory } from "../ai/summarize";
import { CRITICAL } from "../dedupe/critical";
import { MIN_SCORE } from "./breaking";
import { getFeedSources } from "../feeds/registry";
import type { RunDoc } from "../types";

export const PER_RUN = 8;

const utcDayStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

export async function runSummaries(trigger: RunDoc["trigger"] = "schedule") {
  if (!hasSecret("GEMINI_API_KEY") && !hasSecret("GROQ_API_KEY")) {
    return { runId: null, status: "skipped" as const, message: "Story summaries need GEMINI_API_KEY or GROQ_API_KEY." };
  }
  const db = getPostgresDb();
  const settings = await getSettings();
  const now = new Date();

  const doneToday = (
    await db
      .select({ counts: automationRuns.counts })
      .from(automationRuns)
      .where(and(eq(automationRuns.kind, "summaries"), gte(automationRuns.startedAt, utcDayStart(now))))
  ).reduce((n, r) => n + ((r.counts as { written?: number })?.written ?? 0), 0);
  const budget = Math.min(PER_RUN, settings.summariesPerDay - doneToday);
  if (budget <= 0) return { runId: null, status: "skipped" as const, message: `Today's limit of ${settings.summariesPerDay} story summaries is reached.` };

  const recent = await db
    .select({ id: stories.id, title: stories.title, summary: stories.summary, sources: stories.sources, score: stories.score, aiSummary: stories.aiSummary })
    .from(stories)
    .where(gte(stories.lastPublishedAt, new Date(now.getTime() - 24 * 3600_000)))
    .orderBy(sql`${stories.score} DESC`)
    .limit(60);
  const major = recent.filter((s) => s.sources.length >= 2 || s.score >= MIN_SCORE.normal || CRITICAL.test(s.title));
  const todo = major
    .filter((s) => !s.aiSummary || ((s.aiSummary as { sourceCount?: number })?.sourceCount ?? 0) < s.sources.length && now.getTime() - new Date((s.aiSummary as { at: string })?.at).getTime() > 45 * 60_000)
    .slice(0, budget);
  if (!todo.length) return { runId: null, status: "skipped" as const, message: "Every major story already has an up-to-date summary." };

  const [{ id: runId }] = await db
    .insert(automationRuns)
    .values({ kind: "summaries", trigger, startedAt: now, completedAt: null, status: "running" })
    .returning({ id: automationRuns.id });
  const counts = { written: 0, refreshed: 0, failed: 0 };
  const sourceNames = Object.fromEntries((await getFeedSources()).map((feed) => [feed.id, feed.name]));
  const errors: string[] = [];
  for (const story of todo) {
    const articleRows = await db
      .select({ source: articleTable.source, title: articleTable.title, summary: articleTable.summary, publishedAt: articleTable.publishedAt })
      .from(articleTable)
      .innerJoin(storyArticles, eq(articleTable.id, storyArticles.articleId))
      .where(eq(storyArticles.storyId, story.id))
      .orderBy(articleTable.publishedAt)
      .limit(8);
    const articleData = articleRows.map((a) => ({
      source: a.source,
      title: a.title,
      summary: a.summary,
      publishedAt: a.publishedAt,
    }));
    const { summary, error } = await summarizeStory({ title: story.title, articles: articleData, sourceNames });
    if (!summary) {
      counts.failed++;
      if (error) errors.push(error);
      continue;
    }
    await db
      .update(stories)
      .set({ aiSummary: { ...summary, at: new Date().toISOString(), sourceCount: story.sources.length, writtenBy: summary.writtenBy as "gemini" | "groq" } })
      .where(eq(stories.id, story.id));
    if (story.aiSummary) counts.refreshed++;
    counts.written++;
  }
  const status: RunDoc["status"] = counts.written ? (counts.failed ? "partial" : "success") : "failed";
  const message = `${counts.written} story summar${counts.written === 1 ? "y" : "ies"} written (${counts.refreshed} refreshed after more newsrooms joined)${counts.failed ? `, ${counts.failed} failed` : ""}.`;
  await db
    .update(automationRuns)
    .set({ completedAt: new Date(), status, counts, postsCreated: 0, message, error: [...new Set(errors)].join(" | ") || null })
    .where(eq(automationRuns.id, runId));
  return { runId, status, message, counts };
}
