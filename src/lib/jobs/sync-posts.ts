/**
 * Keeps `social_posts` in step with Buffer:
 *   - posts the app scheduled get their real outcome (sent, with the link on X, or failed)
 *   - posts made directly in Buffer for the same X channel are imported
 * Runs every 2 hours (cheap: it only calls Buffer when a post is waiting to be confirmed,
 * plus a full import every 3 hours) and from the admin panel.
 */
import { and, eq, gte, inArray, lte, lt, sql } from "drizzle-orm";
import { getPostgresDb } from "../db/client";
import { outboundPosts, automationRuns } from "../db/schema";
import { retentionCutoff } from "../config";
import { getSettings, saveSettings } from "../settings";
import { bufferConfigured, listChannelPosts, resolveChannel, type BufferPost } from "../social/buffer";
import type { PostStatus, RunDoc, SocialPostDoc } from "../types";

/** Hours between full imports of posts made directly in Buffer. */
export const FULL_SYNC_HOURS = 3;

export function mapBufferStatus(status: string): PostStatus | null {
  switch (status.toLowerCase()) {
    case "sent":
      return "sent";
    case "scheduled":
    case "sending":
      return "scheduled";
    case "error":
      return "failed";
    default:
      return null; // drafts and anything unknown are left alone
  }
}

const toDate = (s: string | null | undefined) => {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
};

export async function runPostSync(trigger: RunDoc["trigger"] = "schedule") {
  const db = getPostgresDb();
  const now = new Date();

  if (!bufferConfigured()) {
    const message = "BUFFER_API_KEY isn't set, so there is nothing to sync.";
    const [{ id: runId }] = await db
      .insert(automationRuns)
      .values({ kind: "post_sync", trigger, startedAt: now, completedAt: now, status: "skipped", message })
      .returning({ id: automationRuns.id });
    return { runId, status: "skipped" as const, message };
  }

  // Runs can be frequent (every 15 minutes). Buffer's free API allows about 100 requests a day,
  // so only call it when a post is waiting to be confirmed, or for the 3-hourly full import.
  // Manual runs always sync.
  if (trigger !== "manual") {
    const settings = await getSettings();
    const fullSyncDue = !settings.lastPostSyncAt || now.getTime() - settings.lastPostSyncAt.getTime() > FULL_SYNC_HOURS * 3600_000;
    const awaiting = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(outboundPosts)
      .where(and(eq(outboundPosts.status, "scheduled"), sql`${outboundPosts.bufferPostId} IS NOT NULL`, lte(outboundPosts.scheduledAt, now)));
    if (!fullSyncDue && (awaiting[0]?.count ?? 0) === 0) {
      return { runId: null, status: "skipped" as const, message: "Nothing waiting on Buffer; no API request made." };
    }
  }

  const [{ id: runId }] = await db
    .insert(automationRuns)
    .values({ kind: "post_sync", trigger, startedAt: now, completedAt: null, status: "running" })
    .returning({ id: automationRuns.id });
  const counts = { fetched: 0, inserted: 0, updated: 0, unchanged: 0, requests: 0 };

  try {
    const settings = await getSettings();
    const { organizationId: orgId, channelId, channels } = await resolveChannel();
    if (channels.length) counts.requests += 2; // a fresh lookup (only when the channel setting changed)

    // First sync: walk back up to 4 pages through the retention window. Afterwards one page is enough.
    const maxPages = settings.lastPostSyncAt ? 1 : 4;
    const cutoff = retentionCutoff(now);
    const fetched: BufferPost[] = [];
    let after: string | null = null;
    for (let page = 0; page < maxPages; page++) {
      const res = await listChannelPosts(orgId, channelId, { first: 50, after });
      counts.requests++;
      fetched.push(...res.posts);
      const oldest = toDate(res.posts[res.posts.length - 1]?.createdAt);
      if (!res.hasNextPage || !res.endCursor || (oldest && oldest < cutoff)) break;
      after = res.endCursor;
    }
    counts.fetched = fetched.length;

    const existing = await db
      .select({ id: outboundPosts.id, bufferPostId: outboundPosts.bufferPostId, status: outboundPosts.status, sentAt: outboundPosts.sentAt, externalUrl: outboundPosts.externalUrl })
      .from(outboundPosts)
      .where(inArray(outboundPosts.bufferPostId, fetched.map((p) => p.id)));
    const byBufferId = new Map(existing.map((e) => [e.bufferPostId!, e]));

    for (const bp of fetched) {
      const status = mapBufferStatus(bp.status);
      if (!status) continue;
      const due = toDate(bp.dueAt) ?? toDate(bp.createdAt) ?? now;
      if (due < cutoff) continue;
      const sentAt = toDate(bp.sentAt);
      const externalUrl = bp.externalLink || null;
      const prev = byBufferId.get(bp.id);

      if (prev) {
        if (prev.status === status && (prev.externalUrl ?? null) === externalUrl && Boolean(prev.sentAt) === Boolean(sentAt)) {
          counts.unchanged++;
          await db.update(outboundPosts).set({ lastSyncedAt: now }).where(eq(outboundPosts.id, prev.id));
          continue;
        }
        await db
          .update(outboundPosts)
          .set({
            status,
            sentAt,
            externalUrl,
            scheduledAt: sentAt ?? due,
            error: status === "failed" ? "Buffer reported that sending failed. Open Buffer to see why." : null,
            updatedAt: now,
            lastSyncedAt: now,
          })
          .where(eq(outboundPosts.id, prev.id));
        counts.updated++;
      } else {
        const doc: SocialPostDoc = {
          storyId: null,
          content: bp.text,
          kind: "other",
          platform: "x",
          status,
          bufferPostId: bp.id,
          scheduledAt: sentAt ?? due,
          createdAt: toDate(bp.createdAt) ?? now,
          updatedAt: now,
          error: status === "failed" ? "Buffer reported that sending failed." : null,
          writtenBy: "buffer",
          runId,
          sentAt,
          externalUrl,
          lastSyncedAt: now,
        };
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
        });
        counts.inserted++;
      }
    }

    await saveSettings({ lastPostSyncAt: now });
    const message = `Read ${counts.fetched} post(s) from Buffer: ${counts.inserted} imported, ${counts.updated} updated, ${counts.unchanged} unchanged (${counts.requests} API request${counts.requests === 1 ? "" : "s"}).`;
    await db.update(automationRuns).set({ completedAt: new Date(), status: "success", counts, message }).where(eq(automationRuns.id, runId));
    return { runId, status: "success" as const, message, counts };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db.update(automationRuns).set({ completedAt: new Date(), status: "failed", counts, error: msg }).where(eq(automationRuns.id, runId));
    throw err;
  }
}
