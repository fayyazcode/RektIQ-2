export type FeedSource = {
  id: string;
  name: string;
  url: string;
  homepage: string;
  glyph: string;
  blurb: string;
};

export type Category =
  | "bitcoin" | "ethereum" | "altcoins" | "defi" | "markets" | "regulation" | "policy"
  | "stablecoins" | "nft" | "layer-2" | "mining" | "security" | "etf" | "business" | "technology" | "ai";

/** An RSS item after normalization, before it touches the database. */
export type NormalizedArticle = {
  source: string;
  guid: string;
  url: string;
  canonicalUrl: string;
  urlHash: string;
  title: string;
  titleKey: string; // lowercase, punctuation-free title for exact-title matching
  titleHash: string;
  summary: string;
  contentHash: string; // title + summary, to detect edits
  author: string | null;
  publishedAt: Date;
  categories: Category[];
  coins: string[];
  rawCategories: string[];
  image: string | null;
  titleTokens: string[]; // content words of the headline
  tokens: string[]; // content words of headline + summary
};

/** Stored article. Similarity tokens live on the story only (they're just for matching). */
export type ArticleDoc = Omit<NormalizedArticle, "tokens" | "titleTokens"> & {
  _id?: any;
  /** Hydrated from the `story_articles` join (Postgres has no `articles.storyId` column). */
  storyId: string | null;
  fetchedAt: Date;
  updatedAt: Date;
  version: number;
  firstRunId: string | null;
};

export type StoryDoc = {
  _id?: any;
  slug: string;
  title: string;
  summary: string;
  primaryArticleId: string;
  /** Hydrated from the `story_articles` join (Postgres has no embedded array). */
  articleIds: string[];
  sources: string[];
  categories: Category[];
  coins: string[];
  titleTokens: string[];
  tokens: string[];
  firstPublishedAt: Date;
  lastPublishedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  score: number;
  aiSummary?: AiSummary | null;
};

export type PostKind = "breaking" | "market" | "insight" | "other";
/** link = short hook + website link; detailed = complete post, no link; humor = funny, no link */
export type PostStyle = "link" | "detailed" | "humor";
/** "sent" and live "failed" states come from Buffer via the post sync job. */
export type PostStatus = "pending_approval" | "scheduled" | "sent" | "failed" | "rejected" | "dry_run";

export type SocialPostDoc = {
  _id?: any;
  storyId: string | null;
  content: string;
  kind: PostKind;
  platform: "x";
  status: PostStatus;
  bufferPostId: string | null;
  scheduledAt: Date;
  createdAt: Date;
  updatedAt: Date;
  error: string | null;
  /** "buffer" = created directly in Buffer and imported by the sync */
  writtenBy: "gemini" | "groq" | "rules" | "manual" | "buffer";
  runId: string | null;
  sentAt?: Date | null;
  /** Link to the published post on X, once Buffer reports it */
  externalUrl?: string | null;
  lastSyncedAt?: Date | null;
  /** "breaking" = sent within the hour by the alert check; "daily" = the scheduled daily set */
  origin?: "daily" | "breaking" | "manual" | "buffer";
  /** Why a breaking alert was sent, e.g. "covered by 3 newsrooms within 2 h" */
  reason?: string | null;
  /** The daily slot this post fills (UTC ISO time), so each slot is written once */
  slotKey?: string | null;
  style?: PostStyle;
};

/** Original summary the AI writes for major stories, from every newsroom's headline and excerpt. */
export type AiSummary = {
  whatHappened: string;
  whyItMatters: string;
  keyFacts: string[];
  writtenBy: "gemini" | "groq";
  at: Date;
  /** Newsrooms covering the story when it was written; a new one joining triggers a refresh */
  sourceCount: number;
};

export type FeedRunResult = {
  source: string;
  status: "ok" | "not_modified" | "error";
  httpStatus: number | null;
  items: number;
  ms: number;
  error?: string;
};

export type IngestStats = {
  fetched: number;
  rejected: number;
  duplicatesInBatch: number;
  unchanged: number; // already stored, identical — the "seen last hour" count
  updated: number; // already stored, but the publisher edited title/summary
  inserted: number;
  mergedIntoStories: number; // new articles that joined an existing story
  newStories: number;
};

export type RunDoc = {
  _id?: any;
  kind: "ingest" | "daily_posts" | "cleanup" | "post_sync" | "breaking" | "summaries";
  trigger: "schedule" | "manual" | "cli";
  startedAt: Date;
  completedAt: Date | null;
  status: "running" | "success" | "partial" | "failed" | "skipped";
  stats?: IngestStats;
  /** Change in inserted articles vs the previous ingest run */
  deltaVsPrevious?: { previousRunId: string | null; insertedDiff: number; newStoriesDiff: number };
  feeds?: FeedRunResult[];
  postsCreated?: number;
  /** Documents removed by the cleanup job, per collection */
  removed?: Record<string, number>;
  /** Generic counters (post sync: fetched / inserted / updated) */
  counts?: Record<string, number>;
  message?: string | null;
  error?: string | null;
};

export type FeedStateDoc = {
  _id: string; // source id
  etag: string | null;
  lastModified: string | null;
  lastSuccessAt: Date | null;
  lastErrorAt: Date | null;
  lastError: string | null;
  consecutiveFailures: number;
  lastItemCount: number;
};

export type SettingsDoc = {
  _id: "global";
  /** Looked up once from Buffer and remembered, to save API requests */
  bufferOrganizationId?: string | null;
  /** Channel resolved from BUFFER_CHANNEL_ID (or found automatically), and the value it was resolved from */
  bufferChannelId?: string | null;
  bufferChannelFor?: string | null;
  lastPostSyncAt?: Date | null;
  postingEnabled: boolean;
  requireApproval: boolean;
  /** 1–24 posts a day, spread over the day */
  postsPerDay: number;
  /** Exact send times (UTC). When fewer than postsPerDay, posts are spread evenly across the window instead. */
  postTimesUtc: string[];
  postWindowStartUtc: string;
  postWindowEndUtc: string;
  disabledSources: string[];
  /** Runtime-managed RSS registry. Missing means use the built-in starter feeds. */
  feedSources?: FeedSource[];
  /** Removed feeds remain here so previously collected stories keep their publisher names. */
  retiredFeedSources?: FeedSource[];
  /** Breaking alerts: post important stories within the hour instead of waiting for the daily set */
  breakingEnabled: boolean;
  breakingMaxPerDay: number;
  breakingMinGapMinutes: number;
  breakingSensitivity: "strict" | "normal" | "relaxed";
  /** Share of each post style, in percent (adds up to 100) */
  postMix: { link: number; detailed: number; humor: number };
  /** Most AI story summaries per day (free-tier friendly) */
  summariesPerDay: number;
  /** Market watchlist (admin → Market CRUD): uppercase symbols tracked by the realtime worker */
  marketWatchlist?: string[];
  /** Degen Radar: assets with market cap at or below this USD amount */
  degenMaxMarketCap?: number;
  /** X generation: signals scoring at or above this value get a draft in the queue */
  xSignalThreshold?: number;
  updatedAt: Date;
};

/* ── View models (serialisable, used by React) ───────────── */

export type StoryView = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  sources: string[];
  categories: Category[];
  coins: string[];
  firstPublishedAt: string;
  lastPublishedAt: string;
  score: number;
  articleCount: number;
  aiSummary: { whatHappened: string; whyItMatters: string; keyFacts: string[]; sourceCount: number; at: string } | null;
};

export type ArticleView = {
  id: string;
  source: string;
  title: string;
  summary: string;
  url: string;
  author: string | null;
  publishedAt: string;
  updatedAt: string;
  version: number;
};

export type PostView = {
  id: string;
  content: string;
  kind: PostKind;
  status: PostStatus;
  scheduledAt: string;
  createdAt: string;
  error: string | null;
  writtenBy: SocialPostDoc["writtenBy"];
  origin: SocialPostDoc["origin"] | null;
  style: PostStyle | null;
  reason: string | null;
  sentAt: string | null;
  externalUrl: string | null;
  storySlug: string | null;
  storyTitle: string | null;
};
