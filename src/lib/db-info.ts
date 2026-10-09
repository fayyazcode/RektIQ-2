import { getPostgresDb } from "./db/client";
import * as schema from "./db/schema";
import { env } from "./env";
import { sql } from "drizzle-orm";

/**
 * Where the data is going, without revealing credentials: the cluster address from
 * DATABASE_URL (user name and password removed) and the database name.
 * Compare the address with Supabase → your project → Connect to be sure it's the same.
 */
export function describeConnection(): { cluster: string; database: string } | null {
  const uri = env.databaseUrl();
  if (!uri) return null;
  try {
    const parsed = new URL(uri);
    const host = `${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}`;
    return { cluster: host || "unknown", database: parsed.pathname.slice(1) || "unknown" };
  } catch {
    return { cluster: "unknown", database: "unknown" };
  }
}

/** Reads PostgreSQL's planner row estimates without scanning every table. */
export async function inspectDatabase() {
  const db = getPostgresDb();
  const rows = await db.execute(sql<{
    table_name: string;
    estimated_count: number | string | null;
  }>`
    SELECT
      c.relname AS table_name,
      CASE WHEN c.reltuples < 0 THEN NULL ELSE c.reltuples::bigint END AS estimated_count
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'app' AND c.relkind IN ('r', 'p')
    ORDER BY c.relname
  `);

  return {
    tables: Object.fromEntries(rows.map((row) => {
      if (typeof row.table_name !== "string") throw new Error("Supabase returned an invalid table name.");
      const count = row.estimated_count == null ? null : Number(row.estimated_count);
      if (count !== null && (!Number.isFinite(count) || count < 0)) {
        throw new Error("Supabase returned an invalid estimated table row count.");
      }
      return [row.table_name, count];
    })) as Record<string, number | null>,
  };
}

/** Executes a small read query to verify the configured database connection. */
export async function testDatabaseConnection() {
  const db = getPostgresDb();
  await db.execute(sql`SELECT 1`);
}
