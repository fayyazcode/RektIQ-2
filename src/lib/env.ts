/**
 * The ONLY place server code reads secrets and settings from the environment.
 *
 * Values come from:
 *   - local development: a `.env` / `.env.local` file (never committed; see .env.example)
 *   - Vercel: Project → Settings → Environment Variables (secrets are encrypted automatically)
 *   - GitHub Actions: repository secrets / variables, passed in by the workflows
 *
 * Nothing here has a real value in source code, and none of these names start with
 * NEXT_PUBLIC_, so Next.js never copies them into browser bundles. Values are read
 * lazily (on first use), so importing this file never fails and builds don't need secrets.
 */

/** Secret values: must never appear in code, logs or build output. */
export const SECRET_KEYS = [
  "DATABASE_URL",
  "DATABASE_MIGRATION_URL",
  "SESSION_SECRET",
  "ADMIN_PASSWORD_HASH",
  "REVALIDATE_SECRET",
  "GEMINI_API_KEY",
  "GROQ_API_KEY",
  "BUFFER_API_KEY",
  "GITHUB_DISPATCH_TOKEN",
  "COINGECKO_DEMO_KEY",
  "JEV_API_KEY",
  "REALTIME_AUTH_SECRET",
  "CRON_SECRET",
  "SUPABASE_SERVICE_ROLE_KEY",
  "X_API_BEARER_TOKEN",
] as const;

/** Non-secret settings (safe to show, safe to appear in build output). */
export const CONFIG_KEYS = [
  "ADMIN_USERNAME",
  "BUFFER_CHANNEL_ID",
  "BUFFER_ORG_ID",
  "BUFFER_DRY_RUN",
  "GEMINI_MODEL",
  "GROQ_MODEL",
  "RETENTION_DAYS",
  "GITHUB_REPO",
  "GITHUB_REF_NAME",
  // market intelligence layer
  "MARKET_PROVIDER",
  "REALTIME_URL",
  "NEXT_PUBLIC_REALTIME_URL",
  "NEXT_PUBLIC_REALTIME_AUTH_TOKEN",
  "AI_PROVIDER_ORDER",
  "JEV_MODEL",
  "FEATURE_MARKET_INTEL",
  // realtime worker (used by scripts/realtime-worker.ts)
  "REALTIME_TICK_SECONDS",
  "REALTIME_ONCE",
] as const;

export type SecretKey = (typeof SECRET_KEYS)[number];
export type ConfigKey = (typeof CONFIG_KEYS)[number];

/**
 * Values pasted into Vercel or GitHub often carry stray characters that a .env file
 * would have removed: surrounding quotes, spaces, line breaks, invisible characters.
 * Clean them here so `BUFFER_CHANNEL_ID="abc"` pasted with its quotes still works.
 */
export function cleanValue(v: string | undefined): string | undefined {
  if (!v) return undefined;
  let s = v.replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
  const quotes = ['"', "'", "`"];
  while (s.length >= 2 && quotes.includes(s[0]) && s.endsWith(s[0])) s = s.slice(1, -1).trim();
  return s || undefined;
}

const read = (name: string): string | undefined => cleanValue(process.env[name]);

/** A secret, or undefined when it isn't set. */
export const secret = (name: SecretKey) => read(name);

/** A secret that the current operation can't work without. The error names the variable, never its value. */
export function requireSecret(name: SecretKey): string {
  const v = read(name);
  if (!v) throw new Error(`Missing environment variable ${name}. Add it to .env.local (local) or your host's environment settings.`);
  return v;
}

export const hasSecret = (name: SecretKey) => Boolean(read(name));

/** A non-secret setting with an optional default. */
export const config = (name: ConfigKey, fallback?: string) => read(name) ?? fallback;

export const env = {
  adminUsername: () => config("ADMIN_USERNAME", "admin")!,
  geminiModel: () => config("GEMINI_MODEL", "gemini-3.5-flash-lite")!,
  groqModel: () => config("GROQ_MODEL", "openai/gpt-oss-20b")!,
  bufferDryRunForced: () => config("BUFFER_DRY_RUN") === "true",
  githubRepo: () => config("GITHUB_REPO"),
  githubRef: () => config("GITHUB_REF_NAME", "main")!,
  databaseUrl: () => secret("DATABASE_URL"),
};

/** Which variables are set, without revealing any value. Used by `npm run check:env` and the admin dashboard. */
export function envReport() {
  return {
    secrets: SECRET_KEYS.map((k) => ({ key: k, set: Boolean(read(k)) })),
    config: CONFIG_KEYS.map((k) => ({ key: k, set: Boolean(read(k)) })),
  };
}
