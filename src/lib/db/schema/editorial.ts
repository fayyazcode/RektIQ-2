import { text, uuid, timestamp, integer, real, jsonb, index, uniqueIndex, primaryKey } from "drizzle-orm/pg-core";
import { app } from "./namespace";
import { automationRuns } from "./operations";

export const articles = app.table("articles", {
  id: uuid("id").defaultRandom().primaryKey(),
  legacyMongoId: text("legacy_mongo_id"),
  source: text("source").notNull(),
  guid: text("guid").notNull(),
  url: text("url").notNull(),
  canonicalUrl: text("canonical_url").notNull(),
  urlHash: text("url_hash").notNull(),
  title: text("title").notNull(),
  titleKey: text("title_key").notNull(),
  titleHash: text("title_hash").notNull(),
  summary: text("summary").notNull().default(""),
  contentHash: text("content_hash").notNull(),
  author: text("author"),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
  categories: text("categories").array().notNull().default([]),
  coins: text("coins").array().notNull().default([]),
  rawCategories: text("raw_categories").array().notNull().default([]),
  image: text("image"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version: integer("version").notNull().default(1),
  firstRunId: uuid("first_run_id").references(() => automationRuns.id, { onDelete: "set null" }),
}, (t) => [uniqueIndex("articles_url_hash_uq").on(t.urlHash), uniqueIndex("articles_legacy_mongo_id_uq").on(t.legacyMongoId), index("articles_source_guid_idx").on(t.source, t.guid), index("articles_published_at_idx").on(t.publishedAt.desc()), index("articles_source_published_idx").on(t.source, t.publishedAt.desc()), index("articles_fetched_at_idx").on(t.fetchedAt.desc()), index("articles_title_hash_idx").on(t.titleHash)]);

export const stories = app.table("stories", {
  id: uuid("id").defaultRandom().primaryKey(),
  legacyMongoId: text("legacy_mongo_id"),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  summary: text("summary").notNull().default(""),
  primaryArticleId: uuid("primary_article_id").notNull().references(() => articles.id, { onDelete: "restrict" }),
  sources: text("sources").array().notNull().default([]),
  categories: text("categories").array().notNull().default([]),
  coins: text("coins").array().notNull().default([]),
  titleTokens: text("title_tokens").array().notNull().default([]),
  tokens: text("tokens").array().notNull().default([]),
  firstPublishedAt: timestamp("first_published_at", { withTimezone: true }).notNull(),
  lastPublishedAt: timestamp("last_published_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  score: real("score").notNull().default(0),
  aiSummary: jsonb("ai_summary").$type<{ whatHappened: string; whyItMatters: string; keyFacts: string[]; writtenBy: string; at: string; sourceCount: number } | null>(),
}, (t) => [uniqueIndex("stories_slug_uq").on(t.slug), uniqueIndex("stories_legacy_mongo_id_uq").on(t.legacyMongoId), index("stories_recent_idx").on(t.lastPublishedAt.desc()), index("stories_created_at_idx").on(t.createdAt.desc()), index("stories_score_idx").on(t.score.desc(), t.lastPublishedAt.desc()), index("stories_category_recent_idx").using("gin", t.categories), index("stories_coins_idx").using("gin", t.coins)]);

export const storyArticles = app.table("story_articles", {
  storyId: uuid("story_id").notNull().references(() => stories.id, { onDelete: "cascade" }),
  articleId: uuid("article_id").notNull().references(() => articles.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.storyId, t.articleId] }), index("story_articles_article_idx").on(t.articleId)]);

export const feedState = app.table("feed_state", {
  sourceId: text("source_id").primaryKey(),
  etag: text("etag"),
  lastModified: text("last_modified"),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
  lastError: text("last_error"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  lastItemCount: integer("last_item_count").notNull().default(0),
});

export const globalSettings = app.table("global_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
