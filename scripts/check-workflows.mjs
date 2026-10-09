#!/usr/bin/env node
/**
 * Catches workflow mistakes before GitHub does (GitHub rejects the whole file):
 *   - the same key twice in one block (e.g. NEXT_PUBLIC_SITE_URL listed twice under env:)
 *   - cron expressions that don't have 5 fields
 *   - secrets./vars. names the app doesn't know (typos)
 * Dependency-free: a small indentation-based scan, enough for these files.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";

const DIR = ".github/workflows";
const KNOWN = new Set([
  "SESSION_SECRET", "ADMIN_PASSWORD_HASH", "REVALIDATE_SECRET", "GEMINI_API_KEY", "GROQ_API_KEY",
  "BUFFER_API_KEY", "GITHUB_DISPATCH_TOKEN", "COINGECKO_DEMO_KEY", "JEV_API_KEY", "REALTIME_AUTH_SECRET",
  "ADMIN_USERNAME", "BUFFER_CHANNEL_ID",
  "BUFFER_ORG_ID", "BUFFER_DRY_RUN", "GEMINI_MODEL", "GROQ_MODEL", "RETENTION_DAYS", "GITHUB_REPO", "SITE_URL", "GITHUB_TOKEN",
  "REALTIME_TICK_SECONDS", "AI_PROVIDER_ORDER", "FEATURE_MARKET_INTEL",
  // PostgreSQL/Supabase secrets (added for migration)
  "DATABASE_URL", "DATABASE_MIGRATION_URL", "SUPABASE_SERVICE_ROLE_KEY", "X_API_BEARER_TOKEN",
]);

const problems = [];
if (existsSync(DIR)) {
  for (const file of readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f))) {
    const lines = readFileSync(`${DIR}/${file}`, "utf8").split("\n");
    const stack = []; // [{ indent, keys: Map }]
    lines.forEach((raw, i) => {
      const line = raw.replace(/\s+#.*$/, "");
      if (!line.trim() || line.trim().startsWith("#")) return;
      const indent = line.length - line.trimStart().length;
      const isItem = line.trimStart().startsWith("- ");
      while (stack.length && (stack[stack.length - 1].indent > indent || (isItem && stack[stack.length - 1].indent >= indent))) stack.pop();
      const m = line.trimStart().replace(/^- /, "").match(/^([A-Za-z0-9_-]+):(\s|$)/);
      if (m) {
        const keyIndent = isItem ? indent + 2 : indent;
        let top = stack[stack.length - 1];
        if (!top || top.indent !== keyIndent || isItem) {
          top = { indent: keyIndent, keys: new Map() };
          stack.push(top);
        }
        if (top.keys.has(m[1])) problems.push(`${file}:${i + 1}: "${m[1]}" is listed twice in the same block (first on line ${top.keys.get(m[1])})`);
        else top.keys.set(m[1], i + 1);
      }
      const cron = raw.match(/cron:\s*["']([^"']+)["']/);
      if (cron && cron[1].trim().split(/\s+/).length !== 5) problems.push(`${file}:${i + 1}: cron "${cron[1]}" needs exactly 5 fields`);
      for (const ref of raw.matchAll(/\b(?:secrets|vars)\.([A-Z0-9_]+)/g)) {
        if (!KNOWN.has(ref[1])) problems.push(`${file}:${i + 1}: unknown name ${ref[0]} (typo?)`);
      }
    });
  }
}

if (problems.length) {
  console.error(`\n✖ Workflow problems:\n  ${problems.join("\n  ")}\n`);
  process.exit(1);
}
console.log("✓ Workflows look valid.");
