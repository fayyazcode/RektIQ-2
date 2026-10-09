import { loadEnvConfig } from "@next/env";
import { defineConfig } from "drizzle-kit";

loadEnvConfig(process.cwd());

const url = process.env.DATABASE_MIGRATION_URL;
if (!url) {
  throw new Error("DATABASE_MIGRATION_URL is required for Drizzle migrations.");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/db/schema/index.ts",
  out: "./supabase/migrations",
  dbCredentials: { url },
  schemaFilter: ["app"],
  strict: true,
  verbose: true,
});
