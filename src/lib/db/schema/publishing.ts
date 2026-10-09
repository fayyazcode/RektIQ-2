import { app } from "./namespace";
import { stories } from "./editorial";
import { automationRuns } from "./operations";
import { sql } from "drizzle-orm";
import { text, uuid, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";

export const outboundPosts = app.table("outbound_posts", {
  id: uuid("id").defaultRandom().primaryKey(),
  legacyMongoId: text("legacy_mongo_id"),
  storyId: uuid("story_id").references(() => stories.id, { onDelete: "set null" }),
  content: text("content").notNull(),
  kind: text("kind").notNull(),
  platform: text("platform").notNull().default("x"),
  status: text("status").notNull(),
  bufferPostId: text("buffer_post_id"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  error: text("error"),
  writtenBy: text("written_by").notNull(),
  runId: uuid("run_id").references(() => automationRuns.id, { onDelete: "set null" }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  externalUrl: text("external_url"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  origin: text("origin"),
  reason: text("reason"),
  slotKey: text("slot_key"),
  style: text("style"),
}, (t) => [
  index("outbound_posts_schedule_idx").on(t.scheduledAt.desc()),
  index("outbound_posts_status_idx").on(t.status, t.scheduledAt.desc()),
  uniqueIndex("outbound_posts_legacy_mongo_id_uq").on(t.legacyMongoId),
  uniqueIndex("outbound_posts_buffer_id_uq").on(t.bufferPostId).where(sql`${t.bufferPostId} IS NOT NULL`),
  uniqueIndex("outbound_posts_slot_uq").on(t.slotKey).where(sql`${t.slotKey} IS NOT NULL`),
]);
