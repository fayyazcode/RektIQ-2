import { articles, stories } from "./editorial";
import { app } from "./namespace";
import { sql } from "drizzle-orm";
import { text, uuid, timestamp, integer, real, boolean, jsonb, index, uniqueIndex, check } from "drizzle-orm/pg-core";

export const assets = app.table("assets", {
  id: uuid("id").defaultRandom().primaryKey(),
  legacyKey: text("legacy_key"),
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),
  chain: text("chain"),
  contractAddress: text("contract_address"),
  providerAssetId: text("provider_asset_id"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  latestSnapshot: jsonb("latest_snapshot").$type<Record<string, unknown>>().notNull().default({}),
  baselineVolume: real("baseline_volume"),
  score: real("score").notNull().default(0),
  scoreComponents: jsonb("score_components").$type<Record<string, number>>().notNull().default({}),
  formulaVersion: text("formula_version").notNull().default("legacy"),
  scoredAt: timestamp("scored_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [check("assets_chain_contract_pair_ck", sql`(${t.chain} IS NULL) = (${t.contractAddress} IS NULL)`), uniqueIndex("assets_legacy_key_uq").on(t.legacyKey), index("assets_symbol_idx").on(t.symbol), index("assets_updated_idx").on(t.updatedAt.desc()), index("assets_score_idx").on(t.score.desc(), t.updatedAt.desc()), uniqueIndex("assets_chain_contract_uq").on(sql`lower(${t.chain})`, sql`lower(${t.contractAddress})`).where(sql`${t.chain} IS NOT NULL AND ${t.contractAddress} IS NOT NULL`), uniqueIndex("assets_identity_ref_uq").on(t.id, t.chain, t.contractAddress), uniqueIndex("assets_provider_id_uq").on(t.providerAssetId).where(sql`${t.providerAssetId} IS NOT NULL`)]);

export const marketSnapshots = app.table("market_snapshots", {
  id: uuid("id").defaultRandom().primaryKey(),
  symbol: text("symbol").notNull(),
  sampledAt: timestamp("sampled_at", { withTimezone: true }).notNull(),
  ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
  snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
  batchStale: boolean("batch_stale").notNull().default(false),
}, (t) => [index("market_snapshots_symbol_time_idx").on(t.symbol, t.sampledAt.desc()), index("market_snapshots_ingested_idx").on(t.ingestedAt.desc())]);

export const marketSignals = app.table("market_signals", {
  id: uuid("id").defaultRandom().primaryKey(),
  legacyMongoId: text("legacy_mongo_id"),
  dedupeKey: text("dedupe_key").notNull(),
  symbol: text("symbol").notNull(),
  type: text("type").notNull(),
  score: real("score").notNull(),
  evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default({}),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  formulaVersion: text("formula_version").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("market_signals_legacy_mongo_id_uq").on(t.legacyMongoId), uniqueIndex("market_signals_dedupe_uq").on(t.dedupeKey), index("market_signals_symbol_time_idx").on(t.symbol, t.occurredAt.desc()), index("market_signals_type_time_idx").on(t.type, t.occurredAt.desc())]);

export const marketSignalEvidence = app.table("market_signal_evidence", {
  id: uuid("id").defaultRandom().primaryKey(),
  signalId: uuid("signal_id").notNull().references(() => marketSignals.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  label: text("label").notNull(),
  value: jsonb("value").$type<unknown>(),
  source: text("source"),
  observedAt: timestamp("observed_at", { withTimezone: true }),
  details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
}, (t) => [index("market_signal_evidence_signal_idx").on(t.signalId)]);

export const marketSignalOutcomes = app.table("market_signal_outcomes", {
  id: uuid("id").defaultRandom().primaryKey(),
  signalId: uuid("signal_id").notNull().references(() => marketSignals.id, { onDelete: "cascade" }),
  horizonMinutes: integer("horizon_minutes").$type<60 | 240>().notNull(),
  status: text("status").$type<"pending" | "success" | "failed" | "mixed" | "not_evaluated">().notNull(),
  tier: text("tier").$type<"large_liquid" | "other">().notNull(),
  tierMinimumPct: real("tier_minimum_pct").notNull(),
  volatilityRangePct: real("volatility_range_pct"),
  volatilityAdjustmentPct: real("volatility_adjustment_pct").notNull().default(0),
  targetPct: real("target_pct").notNull(),
  entryPrice: real("entry_price"),
  endPrice: real("end_price"),
  returnPct: real("return_pct"),
  maxFavorableMovePct: real("max_favorable_move_pct"),
  maxAdverseMovePct: real("max_adverse_move_pct"),
  rollingVolumeChangePct: real("rolling_volume_change_pct"),
  btcReturnPct: real("btc_return_pct"),
  sampleCount: integer("sample_count").notNull().default(0),
  coverageMinutes: integer("coverage_minutes").notNull().default(0),
  reason: text("reason"),
  evaluatedAt: timestamp("evaluated_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("market_signal_outcomes_signal_horizon_uq").on(t.signalId, t.horizonMinutes), index("market_signal_outcomes_horizon_status_idx").on(t.horizonMinutes, t.status)]);

export const anomalies = app.table("anomalies", {
  id: uuid("id").defaultRandom().primaryKey(),
  legacyMongoId: text("legacy_mongo_id"),
  dedupeKey: text("dedupe_key").notNull(),
  symbol: text("symbol").notNull(),
  type: text("type").notNull(),
  severity: text("severity").notNull(),
  observed: real("observed").notNull(),
  baseline: real("baseline").notNull(),
  ratio: real("ratio").notNull(),
  description: text("description").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  baselineWindowHours: real("baseline_window_hours").notNull(),
  formulaVersion: text("formula_version").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("anomalies_legacy_mongo_id_uq").on(t.legacyMongoId), uniqueIndex("anomalies_dedupe_uq").on(t.dedupeKey), index("anomalies_symbol_time_idx").on(t.symbol, t.occurredAt.desc()), index("anomalies_type_time_idx").on(t.type, t.occurredAt.desc())]);

export const newsEntities = app.table("news_entities", {
  id: uuid("id").defaultRandom().primaryKey(),
  articleId: uuid("article_id").notNull().references(() => articles.id, { onDelete: "cascade" }),
  storyId: uuid("story_id").references(() => stories.id, { onDelete: "set null" }),
  symbol: text("symbol").notNull(),
  title: text("title").notNull(),
  url: text("url").notNull(),
  source: text("source").notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("news_entities_article_symbol_uq").on(t.articleId, t.symbol), index("news_entities_symbol_published_idx").on(t.symbol, t.publishedAt.desc())]);

export const newsImpacts = app.table("news_impacts", {
  id: uuid("id").defaultRandom().primaryKey(),
  articleId: uuid("article_id").notNull().references(() => articles.id, { onDelete: "cascade" }),
  symbol: text("symbol").notNull(),
  headline: text("headline").notNull(),
  source: text("source").notNull(),
  url: text("url").notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
  windowMinutes: integer("window_minutes").notNull(),
  priceBefore: real("price_before").notNull(),
  priceAfter: real("price_after").notNull(),
  priceChangePct: real("price_change_pct").notNull(),
  volumeBefore: real("volume_before").notNull(),
  volumeAfter: real("volume_after").notNull(),
  volumeReactionRatio: real("volume_reaction_ratio"),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull(),
  formulaVersion: text("formula_version").notNull(),
}, (t) => [uniqueIndex("news_impacts_article_symbol_uq").on(t.articleId, t.symbol), index("news_impacts_symbol_published_idx").on(t.symbol, t.publishedAt.desc())]);

export const aiAnalyses = app.table("ai_analyses", {
  id: uuid("id").defaultRandom().primaryKey(),
  kind: text("kind").notNull(),
  refType: text("ref_type").notNull(),
  refId: text("ref_id").notNull(),
  symbol: text("symbol").notNull(),
  inputHash: text("input_hash").notNull(),
  result: jsonb("result").$type<Record<string, unknown>>().notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  promptVersion: text("prompt_version").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("ai_analyses_input_hash_uq").on(t.inputHash), index("ai_analyses_ref_idx").on(t.refType, t.refId)]);

export const providerHealth = app.table("provider_health", {
  providerId: text("provider_id").primaryKey(),
  requests: integer("requests").notNull().default(0),
  errors: integer("errors").notNull().default(0),
  rateLimits: integer("rate_limits").notNull().default(0),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
  lastError: text("last_error"),
  avgLatencyMs: real("avg_latency_ms").notNull().default(0),
  stale: boolean("stale").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
