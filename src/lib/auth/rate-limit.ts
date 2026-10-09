import { and, eq, gte, lt, sql } from "drizzle-orm";
import { getPostgresDb } from "../db/client";
import { loginAttempts } from "../db/schema";

const MAX_FAILURES = 5; // per IP per rolling 15-minute window
const WINDOW_MS = 15 * 60 * 1000;

function windowStart() {
  return new Date(Date.now() - WINDOW_MS);
}

export async function isLockedOut(ip: string) {
  const db = getPostgresDb();
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.ip, ip), gte(loginAttempts.attemptedAt, windowStart())));
  return (row?.count ?? 0) >= MAX_FAILURES;
}

export async function recordFailure(ip: string) {
  const db = getPostgresDb();
  const now = new Date();
  await db.insert(loginAttempts).values({ ip, attemptedAt: now });
  // PostgreSQL has no TTL index, so remove expired attempts during writes.
  await db.delete(loginAttempts).where(lt(loginAttempts.attemptedAt, windowStart()));
}

export async function clearFailures(ip: string) {
  const db = getPostgresDb();
  await db.delete(loginAttempts).where(eq(loginAttempts.ip, ip));
}
