"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath, revalidateTag } from "next/cache";
import { NEWS_TAG } from "@/lib/data/queries";
import { z } from "zod";
import { eq, and, inArray, notInArray, sql } from "drizzle-orm";
import { getPostgresDb } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import { memberProfiles, trackedAccountGroups, trackedAccounts } from "@/lib/db/schema";
import { createSession, destroySession, requireAdmin, sessionConfigError } from "@/lib/auth/session";
import { getAdminAuthUser } from "@/lib/supabase/admin";
import { verifyPassword } from "@/lib/auth/password";
import { clearFailures, isLockedOut, recordFailure } from "@/lib/auth/rate-limit";
import { DEFAULT_SETTINGS, getSettings, normalizeWatchlist, saveSettings } from "@/lib/settings";
import { runDailyPosts, sendPost } from "@/lib/jobs/daily-posts";
import { runIngest } from "@/lib/jobs/ingest";
import { runCleanup } from "@/lib/jobs/cleanup";
import { runBreakingAlerts } from "@/lib/jobs/breaking";
import { runSummaries } from "@/lib/jobs/summaries";
import { runPostSync } from "@/lib/jobs/sync-posts";
import { bufferDryRun, resolveChannel } from "@/lib/social/buffer";
import { describeConnection, testDatabaseConnection } from "@/lib/db-info";
import { dispatchWorkflow } from "@/lib/github";
import { composePost, xLength, X_LIMIT } from "@/lib/social/tweet";
import { FEEDS } from "@/lib/config";
import { getFeedSources } from "@/lib/feeds/registry";
import { env, hasSecret, secret } from "@/lib/env";

export type ActionState = { ok?: string; error?: string } | null;

const memberDecisionSchema = z.object({
  userId: z.string().uuid(),
  decision: z.enum(["approve", "reject", "revoke", "reapprove"]),
  note: z.string().trim().max(500, "Keep the decision note to 500 characters or fewer.").optional().transform((value) => value || null),
});

const profileInputSchema = z.object({
  handle: z.string().trim().min(1, "Enter an X handle or profile URL.").max(512),
  displayName: z.string().trim().max(100, "Display name must be 100 characters or fewer.").optional().transform((value) => value || null),
  groups: z.array(z.enum(["majors", "onchain", "momentum"])).min(1, "Choose at least one group."),
});
const accountIdSchema = z.string().uuid();
type TrackedGroup = "majors" | "onchain" | "momentum";

function normalizeXHandle(value: string): { handle: string; normalizedHandle: string } | { error: string } {
  const input = value.trim();
  let handle: string;
  if (/^https?:\/\//i.test(input)) {
    let url: URL;
    try { url = new URL(input); } catch { return { error: "Enter a valid X profile URL." }; }
    if (url.protocol !== "https:" || (url.hostname !== "x.com" && url.hostname !== "twitter.com")) return { error: "Use an @handle, a https://x.com/handle URL, or a https://twitter.com/handle URL." };
    if (url.search || url.hash || !/^\/[A-Za-z0-9_]+\/?$/.test(url.pathname)) return { error: "Use the profile root only, without a query, fragment, or extra path." };
    handle = url.pathname.slice(1).replace(/\/$/, "");
  } else {
    handle = input.startsWith("@") ? input.slice(1) : input;
  }
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) return { error: "X handles use 1–15 letters, numbers, or underscores." };
  return { handle, normalizedHandle: handle.toLowerCase() };
}

function uniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

async function clientIp() {
  const h = await headers();
  return h.get("x-nf-client-connection-ip") || h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

/* ── Auth ─────────────────────────────────────────────── */

export async function loginAction(_: ActionState, form: FormData): Promise<ActionState> {
  const ip = await clientIp();
  try {
    if (await isLockedOut(ip)) return { error: "Too many attempts. Wait 15 minutes and try again." };
  } catch {
    return { error: "The database is slow to answer right now. Wait a few seconds and sign in again." };
  }
  const username = String(form.get("username") ?? "");
  const password = String(form.get("password") ?? "");
  const expectedUser = env.adminUsername();
  const hash = secret("ADMIN_PASSWORD_HASH");
  const configProblem = sessionConfigError();
  if (!hash || configProblem) return { error: `Admin login isn't set up. ${configProblem ?? ""}`.trim() };

  const valid = username === expectedUser && (await verifyPassword(password, hash));
  if (!valid) {
    await recordFailure(ip).catch(() => {});
    return { error: "Username or password is incorrect." };
  }
  await clearFailures(ip).catch(() => {});
  await createSession(username);
  const next = String(form.get("next") ?? "/admin");
  redirect(next.startsWith("/admin") && !next.startsWith("//") ? next : "/admin");
}

export async function logoutAction() {
  await destroySession();
  redirect("/admin/login");
}

/* ── Member access and tracked X profiles ───────────── */

export async function decideMemberAccessAction(_: ActionState, form: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = memberDecisionSchema.safeParse({ userId: form.get("userId"), decision: form.get("decision"), note: form.get("note") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Choose a valid member decision." };
  const { userId, decision, note } = parsed.data;
  const db = getPostgresDb();
  const [profile] = await db.select({ status: memberProfiles.approvalStatus }).from(memberProfiles).where(eq(memberProfiles.userId, userId)).limit(1);
  if (!profile) return { error: "That member request no longer exists." };

  let nextStatus: "approved" | "rejected" | "revoked";
  if (decision === "approve") {
    if (profile.status !== "pending") return { error: "Only pending requests can be approved. Use Re-approve for a rejected or revoked member." };
    nextStatus = "approved";
  } else if (decision === "reject") {
    if (profile.status !== "pending") return { error: "Only pending requests can be rejected." };
    nextStatus = "rejected";
  } else if (decision === "revoke") {
    if (profile.status !== "approved") return { error: "Only approved members can be revoked." };
    nextStatus = "revoked";
  } else {
    if (profile.status !== "rejected" && profile.status !== "revoked") return { error: "Only rejected or revoked members can be re-approved." };
    nextStatus = "approved";
  }

  if (nextStatus === "approved") {
    try {
      const authUser = await getAdminAuthUser(userId);
      if (!authUser?.emailConfirmed) return { error: "The member must confirm their email before approval." };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Unable to verify the member's email confirmation." };
    }
  }

  await db.update(memberProfiles).set({ approvalStatus: nextStatus, role: "member", decidedAt: new Date(), decidedBy: admin.username, decisionNote: note, updatedAt: new Date() }).where(eq(memberProfiles.userId, userId));
  revalidatePath("/admin/access");
  return { ok: nextStatus === "approved" ? "Member access approved." : nextStatus === "rejected" ? "Member request rejected." : "Member access revoked." };
}

async function readProfileInput(form: FormData) {
  const parsed = profileInputSchema.safeParse({ handle: form.get("handle"), displayName: form.get("displayName"), groups: form.getAll("groups") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the profile details." } as const;
  const normalized = normalizeXHandle(parsed.data.handle);
  if ("error" in normalized) return normalized;
  return { ...parsed.data, ...normalized, groups: [...new Set(parsed.data.groups)] as TrackedGroup[] } as const;
}

export async function createTrackedAccountAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const input = await readProfileInput(form);
  if ("error" in input) return { error: input.error };
  try {
    await getPostgresDb().transaction(async (tx) => {
      const [account] = await tx.insert(trackedAccounts).values({ handle: input.handle, normalizedHandle: input.normalizedHandle, displayName: input.displayName, active: true, updatedAt: new Date() }).returning({ id: trackedAccounts.id });
      if (!account) throw new Error("The tracked account could not be created.");
      await tx.insert(trackedAccountGroups).values(input.groups.map((groupKey) => ({ accountId: account.id, groupKey })));
    });
  } catch (error) {
    if (uniqueViolation(error)) return { error: "That X handle is already tracked." };
    return { error: error instanceof Error ? error.message : "Unable to add the X profile." };
  }
  revalidatePath("/admin/profiles");
  return { ok: `@${input.handle} is now tracked.` };
}

export async function updateTrackedAccountAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const accountId = accountIdSchema.safeParse(form.get("accountId"));
  if (!accountId.success) return { error: "Choose a valid X profile to edit." };
  const input = await readProfileInput(form);
  if ("error" in input) return { error: input.error };
  try {
    const updated = await getPostgresDb().transaction(async (tx) => {
      const rows = await tx.update(trackedAccounts).set({ handle: input.handle, normalizedHandle: input.normalizedHandle, displayName: input.displayName, updatedAt: new Date() }).where(eq(trackedAccounts.id, accountId.data)).returning({ id: trackedAccounts.id });
      if (!rows.length) return false;
      await tx.delete(trackedAccountGroups).where(eq(trackedAccountGroups.accountId, accountId.data));
      await tx.insert(trackedAccountGroups).values(input.groups.map((groupKey) => ({ accountId: accountId.data, groupKey })));
      return true;
    });
    if (!updated) return { error: "That X profile no longer exists." };
  } catch (error) {
    if (uniqueViolation(error)) return { error: "That X handle is already tracked by another profile." };
    return { error: error instanceof Error ? error.message : "Unable to save the X profile." };
  }
  revalidatePath("/admin/profiles");
  return { ok: `@${input.handle} updated.` };
}

export async function setTrackedAccountActiveAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const accountId = accountIdSchema.safeParse(form.get("accountId"));
  const active = z.enum(["true", "false"]).safeParse(form.get("active"));
  if (!accountId.success || !active.success) return { error: "Choose a valid X profile action." };
  const rows = await getPostgresDb().update(trackedAccounts).set({ active: active.data === "true", updatedAt: new Date() }).where(eq(trackedAccounts.id, accountId.data)).returning({ handle: trackedAccounts.handle });
  if (!rows.length) return { error: "That X profile no longer exists." };
  revalidatePath("/admin/profiles");
  return { ok: active.data === "true" ? `@${rows[0].handle} re-enabled.` : `@${rows[0].handle} deactivated. Historical references are preserved.` };
}

/* ── Jobs ─────────────────────────────────────────────── */

export async function runJobAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const job = form.get("job");
  const force = form.get("force") === "on";
  try {
    // With a GitHub token, jobs run on Actions (no serverless time limit).
    // Without one (e.g. local development), they run right here.
    if (hasSecret("GITHUB_DISPATCH_TOKEN") && env.githubRepo()) {
      if (job === "ingest") await dispatchWorkflow("hourly-ingest.yml");
      else if (job === "posts") await dispatchWorkflow("daily-posts.yml", { force: force ? "true" : "false" });
      else if (job === "cleanup") await dispatchWorkflow("daily-cleanup.yml");
      else if (job === "sync") await dispatchWorkflow("post-sync.yml");
      else return { error: "Unknown job" };
      return { ok: "Started on GitHub Actions. The run will appear here in about a minute." };
    }
    let message: string | null | undefined;
    if (job === "ingest") {
      const ingest = await runIngest("manual");
      const summaries = await runSummaries("manual").catch((e: Error) => ({ message: `Summaries failed: ${e.message}` }));
      const alert = await runBreakingAlerts("manual").catch((e: Error) => ({ message: `Breaking alert check failed: ${e.message}` }));
      message = `${ingest.message} ${summaries.message ?? ""} ${alert.message ?? ""}`;
    }
    else if (job === "posts") message = (await runDailyPosts({ trigger: "manual", force })).message;
    else if (job === "cleanup") message = (await runCleanup("manual")).message;
    else if (job === "sync") message = (await runPostSync("manual")).message;
    else return { error: "Unknown job" };
    revalidateTag(NEWS_TAG, { expire: 0 });
    revalidatePath("/admin", "layout");
    return { ok: `${message ?? "Done."} See Runs for details.` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/* ── Posts ────────────────────────────────────────────── */

export async function sendPostAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const idSchema = z.string().regex(/^[a-f0-9]{8,64}$/);
  const id = idSchema.safeParse(form.get("id"));
  if (!id.success) return { error: "Invalid post" };
  const content = String(form.get("content") ?? "").trim();
  if (content && xLength(content) > X_LIMIT) return { error: `Too long for X (${xLength(content)}/${X_LIMIT}).` };
  try {
    const r = await sendPost(id.data, content || undefined);
    revalidatePath("/admin/posts");
    revalidateTag(NEWS_TAG, { expire: 0 });
    return { ok: r.status === "dry_run" ? "Saved (dry run: Buffer isn't configured)." : "Scheduled on Buffer." };
  } catch (err) {
    revalidatePath("/admin/posts");
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export async function updatePostStatusAction(form: FormData) {
  await requireAdmin();
  const db = getPostgresDb();
  const idSchema = z.string().regex(/^[a-f0-9]{8,64}$/);
  const id = idSchema.parse(form.get("id"));
  const op = form.get("op");
  if (op === "reject") {
    await db.update(schema.outboundPosts)
      .set({ status: "rejected", updatedAt: new Date() })
      .where(
        and(
          notInArray(schema.outboundPosts.status, ["scheduled", "sent"]),
          eq(schema.outboundPosts.id, id)
        )
      );
  }
  if (op === "delete") {
    await db.delete(schema.outboundPosts).where(
      and(
        notInArray(schema.outboundPosts.status, ["scheduled", "sent"]),
        eq(schema.outboundPosts.id, id)
      )
    );
  }
  revalidatePath("/admin/posts");
}

const manualSchema = z.object({
  content: z.string().trim().min(10).max(1000),
  kind: z.enum(["breaking", "market", "insight"]),
  scheduledAt: z.string().min(1),
});

export async function createManualPostAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = manualSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Write at least 10 characters and pick a time." };
  const when = new Date(`${parsed.data.scheduledAt}:00Z`);
  if (isNaN(when.getTime())) return { error: "That time isn't valid." };
  const content = composePost(parsed.data.content, parsed.data.content.match(/https?:\/\/\S+/)?.[0] ?? null);
  const db = getPostgresDb();
  const now = new Date();
  await db.insert(schema.outboundPosts).values({
    storyId: null,
    content,
    kind: parsed.data.kind,
    platform: "x",
    status: "pending_approval",
    bufferPostId: null,
    scheduledAt: when,
    createdAt: now,
    updatedAt: now,
    error: null,
    writtenBy: "manual",
    runId: null,
  });
  revalidatePath("/admin/posts");
  return { ok: "Added to the queue. Review it below, then send it." };
}

/* ── Settings & sources ──────────────────────────────── */

const sourceFieldsSchema = z.object({
  name: z.string().trim().min(2).max(80),
  url: z.string().trim().url().max(2000).superRefine((raw, ctx) => {
    try {
      const url = new URL(raw);
      if (url.protocol !== "https:") ctx.addIssue({ code: "custom", message: "Use an HTTPS RSS feed URL." });
      if (url.username || url.password) ctx.addIssue({ code: "custom", message: "Feed URLs cannot contain login credentials." });
      if (!url.hostname || /(^|\.)(localhost|local|internal)$/i.test(url.hostname)) {
        ctx.addIssue({ code: "custom", message: "Use a public feed host." });
      }
    } catch {
      ctx.addIssue({ code: "custom", message: "Enter a valid RSS feed URL." });
    }
  }),
  homepage: z.string().trim().max(2000).optional(),
  blurb: z.string().trim().max(240).optional(),
});

function sourceId(name: string, feeds: { id: string }[]) {
  const base = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "rss-source";
  const ids = new Set(feeds.map((feed) => feed.id));
  if (!ids.has(base)) return base;
  let suffix = 2;
  while (ids.has(`${base}-${suffix}`)) suffix++;
  return `${base}-${suffix}`;
}

function normalizedFeedUrl(raw: string) {
  const url = new URL(raw);
  url.hash = "";
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}${url.search}`;
}

function parseFeedForm(form: FormData) {
  const parsed = sourceFieldsSchema.safeParse({
    name: form.get("name"),
    url: form.get("url"),
    homepage: form.get("homepage") || undefined,
    blurb: form.get("blurb") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the source details and try again." } as const;
  let homepage = parsed.data.homepage ?? "";
  if (homepage) {
    try {
      const parsedHomepage = new URL(homepage);
      if (!["https:", "http:"].includes(parsedHomepage.protocol) || parsedHomepage.username || parsedHomepage.password) {
        return { error: "Homepage must be a public HTTP or HTTPS URL." } as const;
      }
    } catch {
      return { error: "Enter a valid publisher homepage URL." } as const;
    }
  } else {
    homepage = new URL(parsed.data.url).origin;
  }
  return {
    data: {
      ...parsed.data,
      homepage,
      blurb: parsed.data.blurb || `Updates from ${parsed.data.name}.`,
      glyph: "◈",
    },
  } as const;
}

export async function saveFeedSourceAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = parseFeedForm(form);
  if ("error" in parsed) return { error: parsed.error };
  const id = String(form.get("sourceId") ?? "").trim();
  const [settings, current] = await Promise.all([getSettings(), getFeedSources()]);
  const feeds = settings.feedSources ?? current;
  const existing = id ? feeds.find((feed) => feed.id === id) : undefined;
  if (id && !existing) return { error: "This source is no longer active. Refresh the page and try again." };
  if (feeds.length >= 50 && !existing) return { error: "You can manage up to 50 active RSS sources." };
  const normalizedUrl = normalizedFeedUrl(parsed.data.url);
  if (feeds.some((feed) => feed.id !== id && normalizedFeedUrl(feed.url) === normalizedUrl)) {
    return { error: "That RSS URL is already in your source list." };
  }
  const source = { ...parsed.data, id: existing?.id ?? sourceId(parsed.data.name, [...feeds, ...(settings.retiredFeedSources ?? [])]) };
  const next = existing
    ? feeds.map((feed) => feed.id === id ? source : feed)
    : [...feeds, source];
  await saveSettings({ feedSources: next });
  revalidatePath("/admin/sources");
  revalidatePath("/admin");
  revalidatePath("/sources");
  revalidatePath("/news");
  revalidatePath("/");
  revalidatePath("/sitemap.xml");
  return { ok: existing ? `${source.name} updated.` : `${source.name} added. It will be checked on the next feed run.` };
}

export async function removeFeedSourceAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const id = String(form.get("sourceId") ?? "").trim();
  if (!id) return { error: "Choose a source to remove." };
  const settings = await getSettings();
  const feeds = settings.feedSources ?? FEEDS;
  const source = feeds.find((feed) => feed.id === id);
  if (!source) return { error: "This source is no longer active. Refresh the page and try again." };
  const retired = settings.retiredFeedSources ?? [];
  await saveSettings({
    feedSources: feeds.filter((feed) => feed.id !== id),
    retiredFeedSources: [...retired.filter((feed) => feed.id !== id), source],
    disabledSources: settings.disabledSources.filter((sourceId) => sourceId !== id),
  });
  revalidatePath("/admin/sources");
  revalidatePath("/admin");
  revalidatePath("/sources");
  revalidatePath("/news");
  revalidatePath("/");
  revalidatePath("/sitemap.xml");
  revalidatePath(`/source/${id}`);
  return { ok: `${source.name} removed from future feed checks. Existing stories are kept.` };
}

const settingsSchema = z.object({
  postsPerDay: z.coerce.number().int().min(1).max(24),
  // Optional exact times; leave empty to spread posts evenly across the window
  postTimesUtc: z.string().transform((s) => s.split(",").map((t) => t.trim()).filter(Boolean)).pipe(z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)).max(24)),
  postWindowStartUtc: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  postWindowEndUtc: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  breakingMaxPerDay: z.coerce.number().int().min(1).max(10),
  breakingMinGapMinutes: z.coerce.number().int().min(15).max(720),
  breakingSensitivity: z.enum(["strict", "normal", "relaxed"]),
  mixLink: z.coerce.number().int().min(0).max(100),
  mixDetailed: z.coerce.number().int().min(0).max(100),
  mixHumor: z.coerce.number().int().min(0).max(100),
  summariesPerDay: z.coerce.number().int().min(0).max(200),
});

export async function saveSettingsAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = settingsSchema.safeParse({
    postsPerDay: form.get("postsPerDay"),
    postTimesUtc: form.get("postTimesUtc") ?? "",
    postWindowStartUtc: form.get("postWindowStartUtc"),
    postWindowEndUtc: form.get("postWindowEndUtc"),
    breakingMaxPerDay: form.get("breakingMaxPerDay"),
    breakingMinGapMinutes: form.get("breakingMinGapMinutes"),
    breakingSensitivity: form.get("breakingSensitivity"),
    mixLink: form.get("mixLink"),
    mixDetailed: form.get("mixDetailed"),
    mixHumor: form.get("mixHumor"),
    summariesPerDay: form.get("summariesPerDay"),
  });
  if (!parsed.success) return { error: "Use 1–24 posts per day, times like 13:00, 17:00 (UTC, 24-hour), and a window such as 08:00 to 22:00." };
  if (parsed.success && parsed.data.mixLink + parsed.data.mixDetailed + parsed.data.mixHumor !== 100) {
    return { error: `The post mix must add up to 100% (now ${parsed.data.mixLink + parsed.data.mixDetailed + parsed.data.mixHumor}%).` };
  }
  if (parsed.data.postWindowEndUtc <= parsed.data.postWindowStartUtc) return { error: "The posting window must end after it starts (UTC, same day)." };
  await saveSettings({
    postingEnabled: form.get("postingEnabled") === "on",
    requireApproval: form.get("requireApproval") === "on",
    postsPerDay: parsed.data.postsPerDay,
    postTimesUtc: [...new Set(parsed.data.postTimesUtc)].sort(),
    postWindowStartUtc: parsed.data.postWindowStartUtc,
    postWindowEndUtc: parsed.data.postWindowEndUtc,
    breakingEnabled: form.get("breakingEnabled") === "on",
    breakingMaxPerDay: parsed.data.breakingMaxPerDay,
    breakingMinGapMinutes: parsed.data.breakingMinGapMinutes,
    breakingSensitivity: parsed.data.breakingSensitivity,
    postMix: { link: parsed.data.mixLink, detailed: parsed.data.mixDetailed, humor: parsed.data.mixHumor },
    summariesPerDay: parsed.data.summariesPerDay,
  });
  revalidatePath("/admin/settings");
  return { ok: "Settings saved. They apply from the next run." };
}

const marketSymbolSchema = z.string().trim().min(1).max(20).transform((value) => value.toUpperCase()).pipe(z.string().regex(/^[A-Z0-9$.-]{1,20}$/));

function readMarketWatchlist(value: unknown): string[] {
  return normalizeWatchlist(value) ?? [...(DEFAULT_SETTINGS.marketWatchlist ?? [])];
}

export async function addMarketWatchlistSymbolAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = marketSymbolSchema.safeParse(form.get("symbol"));
  if (!parsed.success) return { error: "Enter a valid ticker symbol using letters, numbers, dots, or hyphens." };
  const symbol = parsed.data;
  const settings = await getSettings();
  const watchlist = readMarketWatchlist(settings.marketWatchlist);
  if (watchlist.includes(symbol)) return { error: `${symbol} is already on the watchlist.` };
  if (watchlist.length >= 60) return { error: "The realtime watchlist can contain up to 60 coins." };
  await saveSettings({ marketWatchlist: [...watchlist, symbol] });
  revalidatePath("/admin/settings");
  revalidatePath("/admin");
  return { ok: `${symbol} added. The realtime worker will pick it up on its next tick.` };
}

export async function removeMarketWatchlistSymbolAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = marketSymbolSchema.safeParse(form.get("symbol"));
  if (!parsed.success) return { error: "Choose a valid ticker symbol to remove." };
  const symbol = parsed.data;
  const settings = await getSettings();
  const watchlist = readMarketWatchlist(settings.marketWatchlist);
  if (!watchlist.includes(symbol)) return { error: `${symbol} is no longer on the watchlist. Refresh and try again.` };
  await saveSettings({ marketWatchlist: watchlist.filter((item) => item !== symbol) });
  const db = getPostgresDb();
  await db.delete(schema.assets).where(eq(schema.assets.symbol, symbol));
  revalidatePath("/admin/settings");
  revalidatePath("/admin");
  return { ok: `${symbol} removed. Historical signals and market snapshots are kept.` };
}

export async function toggleSourceAction(form: FormData) {
  await requireAdmin();
  const id = String(form.get("source"));
  const feedSources = await getFeedSources();
  if (!feedSources.some((f) => f.id === id)) return;
  const settings = await getSettings();
  const enable = form.get("enable") === "1";
  await getPostgresDb().update(schema.globalSettings)
    .set({
      value: sql`jsonb_set(
        COALESCE(value, '{}'::jsonb),
        '{disabledSources}',
        CASE
          WHEN ${enable} THEN
            COALESCE(value, '{}'::jsonb) - '${id}'
          ELSE
            COALESCE(value, '{}'::jsonb) || jsonb_build_array('${id}')
        END
      )`,
      updatedAt: new Date()
    })
    .where(eq(schema.globalSettings.key, "global"));
  revalidatePath("/admin/sources");
}

/* ── Buffer diagnostics ──────────────────────────────── */

/** Checks the API key, finds the X channel and reports exactly what will be used. Sends nothing. */
export async function testBufferAction(_: ActionState, _form: FormData): Promise<ActionState> {
  await requireAdmin();
  if (!hasSecret("BUFFER_API_KEY")) return { error: "BUFFER_API_KEY isn't set on this server." };
  try {
    const r = await resolveChannel({ force: true });
    const name = r.channel ? `${r.channel.displayName || r.channel.name || "unnamed"} (${r.channel.service})` : r.channelId;
    const others = r.channels.filter((c) => c.id !== r.channelId).map((c) => `${c.displayName || c.name} (${c.service}) ${c.id}`);
    return {
      ok: [
        `Connected. Posts go to ${name}, channel id ${r.channelId}.`,
        r.note,
        others.length ? `Other channels on this account: ${others.join("; ")}.` : null,
        bufferDryRun() ? "Dry run is ON on this server (BUFFER_DRY_RUN=true), so nothing is sent to Buffer from here." : null,
      ]
        .filter(Boolean)
        .join(" "),
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/** Verifies the configured Supabase PostgreSQL connection. */
export async function testDatabaseAction(_: ActionState, _form: FormData): Promise<ActionState> {
  await requireAdmin();
  const where = describeConnection();
  if (!where) return { error: "DATABASE_URL isn't set on this server." };
  try {
    await testDatabaseConnection();
    return { ok: `Connected to Supabase PostgreSQL database "${where.database}" on ${where.cluster}.` };
  } catch (err) {
    return { error: `Couldn't write to ${where.cluster}: ${err instanceof Error ? err.message : String(err)}` };
  }
}