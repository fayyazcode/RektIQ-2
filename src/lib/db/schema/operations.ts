import { app } from "./namespace";
import { text, uuid, timestamp, integer, jsonb, index, uniqueIndex, inet } from "drizzle-orm/pg-core";

export const automationRuns = app.table("automation_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  legacyMongoId: text("legacy_mongo_id"),
  kind: text("kind").notNull(),
  trigger: text("trigger").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  status: text("status").notNull(),
  stats: jsonb("stats").$type<Record<string, unknown>>(),
  deltaVsPrevious: jsonb("delta_vs_previous").$type<Record<string, unknown>>(),
  feeds: jsonb("feeds").$type<Record<string, unknown>[]>(),
  postsCreated: integer("posts_created"),
  removed: jsonb("removed").$type<Record<string, number>>(),
  counts: jsonb("counts").$type<Record<string, number>>(),
  message: text("message"),
  error: text("error"),
}, (t) => [uniqueIndex("automation_runs_legacy_mongo_id_uq").on(t.legacyMongoId), index("automation_runs_kind_started_idx").on(t.kind, t.startedAt.desc()), index("automation_runs_started_idx").on(t.startedAt.desc())]);

export const loginAttempts = app.table("login_attempts", {
  id: uuid("id").defaultRandom().primaryKey(),
  ip: inet("ip").notNull(),
  attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("login_attempts_at_idx").on(t.attemptedAt), index("login_attempts_ip_idx").on(t.ip)]);

export const workerJobRuns = app.table("worker_job_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  jobKey: text("job_key").notNull(),
  status: text("status").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  batchCursor: text("batch_cursor"),
  counts: jsonb("counts").$type<Record<string, number>>().notNull().default({}),
  error: text("error"),
}, (t) => [index("worker_job_runs_key_started_idx").on(t.jobKey, t.startedAt.desc()), index("worker_job_runs_active_lease_idx").on(t.jobKey, t.leaseExpiresAt)]);
