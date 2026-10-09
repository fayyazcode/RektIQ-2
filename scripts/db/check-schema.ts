import "../_env";
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("DATABASE_URL is required to inspect the database schema.");

  const sql = postgres(url, { max: 1, prepare: false, ssl: "require", connect_timeout: 10, connection: { application_name: "rektoiq-schema-check" } });
  try {
    const rows = await sql<{ table_name: string; row_security: boolean }[]>`
      SELECT c.relname AS table_name, c.relrowsecurity AS row_security
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'app' AND c.relkind = 'r'
      ORDER BY c.relname
    `;
    if (!rows.length) {
      console.log("No app schema tables found. Apply the reviewed local migration before using this inventory command.");
    } else {
      console.log(`Found ${rows.length} app tables; RLS enabled on ${rows.filter((row) => row.row_security).length}.`);
      for (const row of rows) console.log(`${row.row_security ? "RLS" : "NO RLS"} ${row.table_name}`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error("[check-schema] failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
