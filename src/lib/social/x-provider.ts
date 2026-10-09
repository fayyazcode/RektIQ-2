/**
 * X (Twitter) social provider — the only place X API v2 response shapes are known.
 * Everything upstream consumes the normalized XPost / XPostPage types below.
 *
 * Server-side only: reads X_API_BEARER_TOKEN via lib/env (never NEXT_PUBLIC_*).
 * Browsers must never call this provider. When no bearer token is configured the
 * provider reports state "not_configured" and returns no posts — it never
 * fabricates social data. This mirrors the market layer's provider/health pattern
 * (see src/lib/market/coingecko.ts and src/lib/market/health.ts).
 */
import { secret } from "../env";

const BASE = "https://api.x.com/2";
const FETCH_TIMEOUT_MS = 10_000;
/** X API v2 user-timeline max_results bounds. */
const MIN_PAGE = 5;
const MAX_PAGE = 100;
export const X_COLLECTION_WINDOW_MS = 2 * 60 * 60_000;
const X_COLLECTION_OVERLAP_MS = 60_000;

export type XProviderState = "not_configured" | "ok";

export type XProviderHealth = {
  state: XProviderState;
  configured: boolean;
  checkedAt: string;
  detail: string;
};

/** A tracked account reference. `platformAccountId` is the X user id when known. */
export type XAccountRef = {
  handle: string;
  platformAccountId?: string | null;
};

export type XFetchOptions = {
  /** Pagination token from a previous page; null/omitted starts from the newest. */
  cursor?: string | null;
  /** X post id lower bound; only posts newer than this id are returned. */
  sinceId?: string | null;
  /** Requested page size; clamped to the provider's [5, 100] bounds. */
  limit: number;
  /** ISO lower bound; only posts published at/after this time are returned. */
  startTime?: string | null;
};

/** Normalized engagement metrics, matching app.social_engagement_observations. */
export type XPostMetrics = {
  likes: number;
  reposts: number;
  replies: number;
  quotes: number;
  bookmarks: number;
  impressions: number | null;
};

/** One normalized post, matching the durable fields of app.social_posts. */
export type XPost = {
  platformPostId: string;
  authorHandle: string;
  sourceUrl: string;
  publishedAt: Date;
  rawText: string;
  language: string | null;
  conversationId: string | null;
  referencedPostIds: string[];
  expandedUrls: string[];
  mediaDescriptions: string[];
  metrics: XPostMetrics;
  /** When these metrics were observed (re-polling updates metrics, never duplicates the post). */
  observedAt: Date;
};

export type XPostPage = {
  posts: XPost[];
  nextCursor: string | null;
  hasMore: boolean;
  userId: string | null;
  /** "not_configured" short-circuits with empty posts and no network call. */
  notConfigured: boolean;
};

export interface XProvider {
  readonly id: string;
  /** Configuration-based health; performs no network call and never throws. */
  health(): XProviderHealth;
  /** Bounded account-post fetch. Throws on rate-limit/provider errors; never fabricates posts. */
  fetchAccountPosts(account: XAccountRef, opts: XFetchOptions): Promise<XPostPage>;
}

export class XRateLimitedError extends Error {
  readonly retryAfterMs: number;
  constructor(retryAfterMs: number) {
    super(`X API rate limited (retry after ${Math.round(retryAfterMs / 1000)}s)`);
    this.name = "XRateLimitedError";
    this.retryAfterMs = retryAfterMs;
  }
}

export class XProviderError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "XProviderError";
    this.status = status;
  }
}

const clampLimit = (n: number) => Math.min(MAX_PAGE, Math.max(MIN_PAGE, Math.trunc(n) || MIN_PAGE));
const intOrZero = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.trunc(v) : 0);
const intOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.trunc(v) : null);

/** Raw X API v2 tweet shape (only the fields we request). */
export type RawXTweet = {
  id: string;
  text: string;
  created_at?: string | null;
  lang?: string | null;
  conversation_id?: string | null;
  referenced_tweets?: { id: string; type: string }[] | null;
  entities?: { urls?: { expanded_url?: string | null }[] | null } | null;
  attachments?: { media_keys?: string[] | null } | null;
  public_metrics?: {
    retweet_count?: number | null;
    reply_count?: number | null;
    like_count?: number | null;
    quote_count?: number | null;
    bookmark_count?: number | null;
    impression_count?: number | null;
  } | null;
};

export type RawXMedia = { media_key: string; alt_text?: string | null };

export function xCollectionStartTime(now: Date, lastSuccessfulAt?: Date | null) {
  const nowMs = now.getTime();
  const windowStart = nowMs - X_COLLECTION_WINDOW_MS;
  const previousSuccess = lastSuccessfulAt?.getTime();
  const start = previousSuccess !== undefined && Number.isFinite(previousSuccess)
    ? Math.max(windowStart, Math.min(nowMs - X_COLLECTION_OVERLAP_MS, previousSuccess - X_COLLECTION_OVERLAP_MS))
    : windowStart;
  return new Date(start).toISOString();
}

/**
 * Pure normalization so it is unit-testable without network access. Returns null
 * for a row missing the identity fields we cannot reconstruct.
 */
export function normalizeXTweet(
  tweet: RawXTweet,
  authorHandle: string,
  observedAt: Date,
  mediaByKey: Map<string, RawXMedia> = new Map(),
): XPost | null {
  const id = tweet.id;
  if (!id || typeof tweet.text !== "string") return null;
  const createdAt = tweet.created_at ? new Date(tweet.created_at) : null;
  if (!createdAt || Number.isNaN(createdAt.getTime())) return null;
  const handle = authorHandle.replace(/^@/, "");
  const m = tweet.public_metrics ?? {};
  return {
    platformPostId: id,
    authorHandle: handle,
    sourceUrl: `https://x.com/${handle}/status/${id}`,
    publishedAt: createdAt,
    rawText: tweet.text,
    language: tweet.lang ?? null,
    conversationId: tweet.conversation_id ?? null,
    referencedPostIds: (tweet.referenced_tweets ?? []).map((reference) => reference.id).filter(Boolean),
    expandedUrls: [...new Set((tweet.entities?.urls ?? [])
      .map((url) => url.expanded_url?.trim())
      .filter((url): url is string => Boolean(url)))],
    mediaDescriptions: [...new Set((tweet.attachments?.media_keys ?? [])
      .map((key) => mediaByKey.get(key)?.alt_text?.trim())
      .filter((description): description is string => Boolean(description)))],
    metrics: {
      likes: intOrZero(m.like_count),
      reposts: intOrZero(m.retweet_count),
      replies: intOrZero(m.reply_count),
      quotes: intOrZero(m.quote_count),
      bookmarks: intOrZero(m.bookmark_count),
      impressions: intOrNull(m.impression_count),
    },
    observedAt,
  };
}

async function fetchWithTimeout(url: string, token: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { Authorization: `Bearer ${token}`, "User-Agent": "rektoiq-social-collector" },
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Maps an HTTP failure to a typed error, honoring Retry-After on 429. */
async function toError(res: Response): Promise<XRateLimitedError | XProviderError> {
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get("retry-after"));
    const ms = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 60_000;
    return new XRateLimitedError(ms);
  }
  let detail = "";
  try {
    const body = (await res.json()) as { detail?: string; title?: string };
    detail = body?.detail || body?.title || "";
  } catch {
    detail = "";
  }
  return new XProviderError(res.status, `X API request failed (${res.status})${detail ? `: ${detail}` : ""}`);
}

class GatedXProvider implements XProvider {
  readonly id = "x";

  health(): XProviderHealth {
    const configured = Boolean(secret("X_API_BEARER_TOKEN"));
    return {
      state: configured ? "ok" : "not_configured",
      configured,
      checkedAt: new Date().toISOString(),
      detail: configured
        ? "X API bearer token is configured."
        : "X_API_BEARER_TOKEN is not set; social collection is disabled and no data is fabricated.",
    };
  }

  async fetchAccountPosts(account: XAccountRef, opts: XFetchOptions): Promise<XPostPage> {
    const empty: XPostPage = { posts: [], nextCursor: null, hasMore: false, userId: null, notConfigured: true };
    const token = secret("X_API_BEARER_TOKEN");
    if (!token) return empty; // honest not_configured short-circuit; no network, no fabricated posts

    const handle = account.handle.replace(/^@/, "");
    if (!handle) throw new XProviderError(0, "A tracked account handle is required to fetch posts.");

    const userId = account.platformAccountId?.trim() || (await this.resolveUserId(handle, token));
    const limit = clampLimit(opts.limit);
    const params = new URLSearchParams({
      "tweet.fields": "created_at,lang,public_metrics,conversation_id,referenced_tweets,entities,attachments",
      max_results: String(limit),
      exclude: "retweets",
    });
    if (opts.cursor) params.set("pagination_token", opts.cursor);
    else if (opts.sinceId) params.set("since_id", opts.sinceId);
    if (opts.startTime) params.set("start_time", opts.startTime);
    if (opts.startTime) {
      params.set("expansions", "attachments.media_keys");
      params.set("media.fields", "media_key,alt_text");
    }

    const observedAt = new Date();
    const res = await fetchWithTimeout(`${BASE}/users/${encodeURIComponent(userId)}/tweets?${params}`, token);
    if (!res.ok) throw await toError(res);
    const body = (await res.json()) as {
      data?: RawXTweet[];
      includes?: { media?: RawXMedia[] };
      meta?: { next_token?: string | null; result_count?: number };
    };

    const mediaByKey = new Map((body.includes?.media ?? []).map((media) => [media.media_key, media]));
    const posts: XPost[] = [];
    for (const raw of body.data ?? []) {
      const post = normalizeXTweet(raw, handle, observedAt, mediaByKey);
      const startTime = opts.startTime ? Date.parse(opts.startTime) : Number.NEGATIVE_INFINITY;
      if (post && post.publishedAt.getTime() >= startTime && post.publishedAt <= observedAt) posts.push(post);
    }
    const nextCursor = body.meta?.next_token ?? null;
    return { posts, nextCursor, hasMore: Boolean(nextCursor), userId, notConfigured: false };
  }

  /** Bounded handle→user-id resolution for accounts whose id is not yet stored. */
  private async resolveUserId(handle: string, token: string): Promise<string> {
    const res = await fetchWithTimeout(`${BASE}/users/by/username/${encodeURIComponent(handle)}`, token);
    if (!res.ok) throw await toError(res);
    const body = (await res.json()) as { data?: { id?: string } };
    const id = body.data?.id;
    if (!id) throw new XProviderError(404, `X account @${handle} was not found.`);
    return id;
  }
}

let cached: XProvider | null = null;

/** Returns the process-wide gated X provider. */
export function getXProvider(): XProvider {
  cached ??= new GatedXProvider();
  return cached;
}
