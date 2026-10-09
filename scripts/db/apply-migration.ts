/**
 * Applies a reviewed, source-controlled SQL migration to the hosted Supabase
 * project. Read-only guard: refuses to run when the `app` schema already has
 * tables (prevents accidental double-apply) unless --force is passed.
 *
 * Runs the whole file as ONE transaction so a partial failure rolls back.
 * Uses the pooled connection; the migration contains no transaction-hostile
 * statements (no CREATE INDEX CONCURRENTLY etc.).
 */
import "../_env";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";

const DEFAULT_MIGRATION = resolve(process.cwd(), "supabase/migrations/20261005120000_initial_schema.sql");

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const fileArg = args.find((a) => !a.startsWith("--"));
  const file = fileArg ? resolve(process.cwd(), fileArg) : DEFAULT_MIGRATION;

  const url = (process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL ?? "").trim();
  if (!url) throw new Error("DATABASE_MIGRATION_URL or DATABASE_URL is required to apply a migration.");

  const sqlText = readFileSync(file, "utf8");
  const sql = postgres(url, { max: 1, prepare: false, ssl: "require", connect_timeout: 15, connection: { application_name: "rektoiq-apply-migration" } });
  try {
    const existing = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'app' AND c.relkind = 'r'
    `;
    const count = existing[0]?.n ?? 0;
    if (count > 0 && !force) {
      throw new Error(`Refusing to apply: app schema already has ${count} tables. Use --force only if you intend to re-apply.`);
    }

    await sql.begin((tx) => tx.unsafe(sqlText));

    const after = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'app' AND c.relkind = 'r'
    `;
    console.log(`[apply] applied ${file}. app tables now: ${after[0]?.n ?? 0}.`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error("[apply] failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
