import "server-only";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

type DatabaseRuntime = { client: ReturnType<typeof postgres> | null };
const globalForDatabase = globalThis as typeof globalThis & { __rektoiqPg?: DatabaseRuntime };

function getClient() {
  if (globalForDatabase.__rektoiqPg?.client) return globalForDatabase.__rektoiqPg.client;
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_URL is required for the Postgres data layer.");
  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL.");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use the postgres:// or postgresql:// scheme.");
  }

  const client = postgres(connectionString, {
    // Small per-instance pool for serverless runtimes; use Supabase's pooled URL.
    max: 3,
    idle_timeout: 20,
    connect_timeout: 10,
    connection: {
      application_name: "rektoiq-web",
      statement_timeout: 8_000,
      lock_timeout: 5_000,
    },
    // Supabase transaction poolers do not support named prepared statements.
    prepare: false,
  });
  globalForDatabase.__rektoiqPg ??= { client: null };
  globalForDatabase.__rektoiqPg.client = client;
  return client;
}

/** Server-only Drizzle database. DATABASE_URL must be a pooled Supabase URL. */
export const getPostgresDb = () => drizzle(getClient(), { schema });

/** Close the Postgres client pool. Safe to call multiple times. */
export async function closePostgresDb() {
  const c = globalForDatabase.__rektoiqPg?.client;
  if (c) {
    await c.end();
    if (globalForDatabase.__rektoiqPg) {
      globalForDatabase.__rektoiqPg.client = null;
    }
  }
}