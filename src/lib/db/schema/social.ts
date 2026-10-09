import { app } from "./namespace";
import { assets } from "./intelligence";
import { sql } from "drizzle-orm";
import { pgSchema, text, uuid, timestamp, integer, real, boolean, jsonb, index, uniqueIndex, primaryKey, check, foreignKey } from "drizzle-orm/pg-core";

// Auth owns this table. It is included only to describe the FK; migrations are
// filtered to `app` and never create or alter Supabase-managed auth objects.
const auth = pgSchema("auth");
const authUsers = auth.table("users", { id: uuid("id").primaryKey() });

export const memberProfiles = app.table("member_profiles", {
  userId: uuid("user_id").primaryKey().references(() => authUsers.id, { onDelete: "cascade" }),
  approvalStatus: text("approval_status").$type<"pending" | "approved" | "rejected" | "revoked">().notNull().default("pending"),
  role: text("role").$type<"member">().notNull().default("member"),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decidedBy: text("decided_by"),
  decisionNote: text("decision_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [check("member_profiles_approval_status_ck", sql`${t.approvalStatus} IN ('pending','approved','rejected','revoked')`), check("member_profiles_role_ck", sql`${t.role} = 'member'`), index("member_profiles_approval_idx").on(t.approvalStatus, t.requestedAt)]);

export const trackedAccounts = app.table("tracked_accounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  handle: text("handle").notNull(),
  normalizedHandle: text("normalized_handle").notNull(),
  displayName: text("display_name"),
  platformAccountId: text("platform_account_id"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("tracked_accounts_handle_uq").on(t.normalizedHandle), uniqueIndex("tracked_accounts_platform_id_uq").on(t.platformAccountId), index("tracked_accounts_active_idx").on(t.active)]);

export const trackedAccountGroups = app.table("tracked_account_groups", {
  accountId: uuid("account_id").notNull().references(() => trackedAccounts.id, { onDelete: "cascade" }),
  groupKey: text("group_key").$type<"majors" | "onchain" | "momentum">().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.accountId, t.groupKey] }), check("tracked_account_groups_group_key_ck", sql`${t.groupKey} IN ('majors','onchain','momentum')`), index("tracked_account_groups_group_idx").on(t.groupKey, t.accountId)]);

export const socialPosts = app.table("social_posts", {
  id: uuid("id").defaultRandom().primaryKey(),
  platform: text("platform").notNull().default("x"),
  platformPostId: text("platform_post_id").notNull(),
  accountId: uuid("account_id").notNull().references(() => trackedAccounts.id, { onDelete: "restrict" }),
  authorHandle: text("author_handle").notNull(),
  sourceUrl: text("source_url").notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
  rawText: text("raw_text"),
  rawTextExpiresAt: timestamp("raw_text_expires_at", { withTimezone: true }).notNull(),
  language: text("language"),
  postMetadata: jsonb("post_metadata").$type<Record<string, unknown>>().notNull().default({}),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [check("social_posts_raw_text_retention_ck", sql`${t.rawText} IS NULL OR ${t.rawTextExpiresAt} <= ${t.publishedAt} + interval '20 days'`), uniqueIndex("social_posts_platform_id_uq").on(t.platform, t.platformPostId), index("social_posts_account_published_idx").on(t.accountId, t.publishedAt.desc()), index("social_posts_raw_expiry_idx").on(t.rawTextExpiresAt).where(sql`${t.rawText} IS NOT NULL`)]);

export const socialAssetMentions = app.table("social_asset_mentions", {
  id: uuid("id").defaultRandom().primaryKey(),
  postId: uuid("post_id").notNull().references(() => socialPosts.id, { onDelete: "cascade" }),
  assetId: uuid("asset_id").references(() => assets.id, { onDelete: "set null" }),
  modelKind: text("model_kind").$type<"majors" | "onchain">().notNull(),
  referencedSymbol: text("referenced_symbol"),
  chain: text("chain"),
  contractAddress: text("contract_address"),
  confidence: real("confidence").notNull(),
  attributionStatus: text("attribution_status").notNull(),
  evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [check("social_mentions_confidence_ck", sql`${t.confidence} >= 0 AND ${t.confidence} <= 1`), check("social_mentions_identity_pair_ck", sql`(${t.chain} IS NULL) = (${t.contractAddress} IS NULL)`), check("social_mentions_onchain_identity_ck", sql`${t.modelKind} <> 'onchain' OR ${t.assetId} IS NULL OR (${t.chain} IS NOT NULL AND ${t.contractAddress} IS NOT NULL)`), foreignKey({ name: "social_mentions_asset_identity_fk", columns: [t.assetId, t.chain, t.contractAddress], foreignColumns: [assets.id, assets.chain, assets.contractAddress] }).onDelete("set null"), uniqueIndex("social_mentions_post_asset_uq").on(t.postId, t.assetId).where(sql`${t.assetId} IS NOT NULL`), index("social_mentions_asset_idx").on(t.assetId, t.createdAt.desc()), index("social_mentions_unresolved_idx").on(t.attributionStatus, t.createdAt.desc())]);

export const socialEngagementObservations = app.table("social_engagement_observations", {
  id: uuid("id").defaultRandom().primaryKey(),
  postId: uuid("post_id").notNull().references(() => socialPosts.id, { onDelete: "cascade" }),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  likes: integer("likes").notNull().default(0),
  reposts: integer("reposts").notNull().default(0),
  replies: integer("replies").notNull().default(0),
  quotes: integer("quotes").notNull().default(0),
  bookmarks: integer("bookmarks").notNull().default(0),
  impressions: integer("impressions"),
  uniqueEngagedAccounts: integer("unique_engaged_accounts"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
}, (t) => [uniqueIndex("social_engagement_post_time_uq").on(t.postId, t.observedAt), index("social_engagement_time_idx").on(t.observedAt.desc())]);

export const socialAnalyses = app.table("social_analyses", {
  id: uuid("id").defaultRandom().primaryKey(),
  modelKind: text("model_kind").$type<"majors" | "onchain">().notNull(),
  assetId: uuid("asset_id").references(() => assets.id, { onDelete: "set null" }),
  analysisKey: text("analysis_key").notNull(),
  schemaVersion: text("schema_version").notNull(),
  modelVersion: text("model_version").notNull(),
  promptVersion: text("prompt_version").notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  sentiment: text("sentiment").notNull(),
  confidence: real("confidence").notNull(),
  score: real("score").notNull(),
  components: jsonb("components").$type<Record<string, number | string | boolean | null>>().notNull(),
  summary: text("summary").notNull(),
  caveats: text("caveats").array().notNull().default([]),
  analyzedAt: timestamp("analyzed_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [check("social_analyses_model_kind_ck", sql`${t.modelKind} IN ('majors','onchain')`), check("social_analyses_confidence_ck", sql`${t.confidence} >= 0 AND ${t.confidence} <= 1`), uniqueIndex("social_analyses_key_uq").on(t.analysisKey), index("social_analyses_asset_time_idx").on(t.assetId, t.analyzedAt.desc()), index("social_analyses_model_time_idx").on(t.modelKind, t.analyzedAt.desc())]);

export const socialAnalysisEvidence = app.table("social_analysis_evidence", {
  analysisId: uuid("analysis_id").notNull().references(() => socialAnalyses.id, { onDelete: "cascade" }),
  postId: uuid("post_id").references(() => socialPosts.id, { onDelete: "set null" }),
  platformPostId: text("platform_post_id").notNull(),
  authorHandle: text("author_handle").notNull(),
  sourceUrl: text("source_url").notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
  evidenceSummary: text("evidence_summary").notNull(),
  evidenceData: jsonb("evidence_data").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.analysisId, t.platformPostId] }), index("social_analysis_evidence_post_idx").on(t.postId)]);

export const socialSignals = app.table("social_signals", {
  id: uuid("id").defaultRandom().primaryKey(),
  dedupeKey: text("dedupe_key").notNull(),
  modelKind: text("model_kind").$type<"majors" | "onchain">().notNull(),
  modelVersion: text("model_version").notNull(),
  schemaVersion: text("schema_version").notNull(),
  promptVersion: text("prompt_version").notNull(),
  formulaVersion: text("formula_version").notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  assetId: uuid("asset_id").notNull().references(() => assets.id, { onDelete: "restrict" }),
  assetChain: text("asset_chain"),
  assetContractAddress: text("asset_contract_address"),
  direction: text("direction").$type<"bullish" | "bearish" | "neutral">().notNull(),
  label: text("label").notNull(),
  score: real("score").notNull(),
  confidence: real("confidence").notNull(),
  dimensions: jsonb("dimensions").$type<Record<string, number | string | boolean | null>>().notNull(),
  explanation: text("explanation").notNull(),
  status: text("status").$type<"active" | "expired" | "withdrawn">().notNull().default("active"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [check("social_signals_model_kind_ck", sql`${t.modelKind} IN ('majors','onchain')`), check("social_signals_onchain_identity_ck", sql`${t.modelKind} <> 'onchain' OR (${t.assetChain} IS NOT NULL AND ${t.assetContractAddress} IS NOT NULL)`), check("social_signals_identity_pair_ck", sql`(${t.assetChain} IS NULL) = (${t.assetContractAddress} IS NULL)`), foreignKey({ name: "social_signals_asset_identity_fk", columns: [t.assetId, t.assetChain, t.assetContractAddress], foreignColumns: [assets.id, assets.chain, assets.contractAddress] }).onDelete("restrict"), check("social_signals_direction_ck", sql`${t.direction} IN ('bullish','bearish','neutral')`), check("social_signals_confidence_ck", sql`${t.confidence} >= 0 AND ${t.confidence} <= 1`), check("social_signals_status_ck", sql`${t.status} IN ('active','expired','withdrawn')`), uniqueIndex("social_signals_dedupe_uq").on(t.dedupeKey), index("social_signals_asset_time_idx").on(t.assetId, t.occurredAt.desc()), index("social_signals_model_time_idx").on(t.modelKind, t.occurredAt.desc())]);

export const socialAnalysisSignals = app.table("social_analysis_signals", {
  analysisId: uuid("analysis_id").notNull().references(() => socialAnalyses.id, { onDelete: "cascade" }),
  signalId: uuid("signal_id").notNull().references(() => socialSignals.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.analysisId, t.signalId] }), index("social_analysis_signals_signal_idx").on(t.signalId)]);

export const socialSignalEvidence = app.table("social_signal_evidence", {
  id: uuid("id").defaultRandom().primaryKey(),
  signalId: uuid("signal_id").notNull().references(() => socialSignals.id, { onDelete: "cascade" }),
  postId: uuid("post_id").references(() => socialPosts.id, { onDelete: "set null" }),
  platformPostId: text("platform_post_id").notNull(),
  authorHandle: text("author_handle").notNull(),
  sourceUrl: text("source_url").notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
  evidenceSummary: text("evidence_summary").notNull(),
  evidenceData: jsonb("evidence_data").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("social_signal_evidence_signal_post_uq").on(t.signalId, t.platformPostId), index("social_signal_evidence_signal_idx").on(t.signalId)]);

export const socialSignalOutcomes = app.table("social_signal_outcomes", {
  id: uuid("id").defaultRandom().primaryKey(),
  signalId: uuid("signal_id").notNull().references(() => socialSignals.id, { onDelete: "cascade" }),
  horizonHours: integer("horizon_hours").$type<4 | 24 | 168>().notNull(),
  status: text("status").$type<"pending" | "success" | "failed" | "mixed" | "not_evaluated">().notNull().default("pending"),
  entryPrice: real("entry_price"),
  endPrice: real("end_price"),
  returnPct: real("return_pct"),
  maxFavorableMovePct: real("max_favorable_move_pct"),
  maxAdverseMovePct: real("max_adverse_move_pct"),
  sampleCount: integer("sample_count").notNull().default(0),
  coverageMinutes: integer("coverage_minutes").notNull().default(0),
  context: jsonb("context").$type<Record<string, unknown>>().notNull().default({}),
  reason: text("reason"),
  evaluatedAt: timestamp("evaluated_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [check("social_signal_outcomes_horizon_ck", sql`${t.horizonHours} IN (4,24,168)`), check("social_signal_outcomes_status_ck", sql`${t.status} IN ('pending','success','failed','mixed','not_evaluated')`), check("social_signal_outcomes_coverage_ck", sql`${t.sampleCount} >= 0 AND ${t.coverageMinutes} >= 0`), uniqueIndex("social_signal_outcomes_horizon_uq").on(t.signalId, t.horizonHours), index("social_signal_outcomes_horizon_status_idx").on(t.horizonHours, t.status)]);

export const trackedAccountCursors = app.table("tracked_account_cursors", {
  accountId: uuid("account_id").primaryKey().references(() => trackedAccounts.id, { onDelete: "cascade" }),
  sinceId: text("since_id"),
  nextToken: text("next_token"),
  lastCollectedAt: timestamp("last_collected_at", { withTimezone: true }),
  lastSuccessfulAt: timestamp("last_successful_at", { withTimezone: true }),
  lastError: text("last_error"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
