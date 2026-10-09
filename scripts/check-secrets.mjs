#!/usr/bin/env node
/**
 * Stops a deploy before a secret leaks, with a clear message (names and file paths only,
 * never the secret itself). Runs automatically before and after `npm run build`.
 *
 *   node scripts/check-secrets.mjs            scan the repository's tracked files
 *   node scripts/check-secrets.mjs --output   scan the build output (.next) for the values
 *                                             of secret environment variables
 *
 * Checks:
 *   1. No .env files are committed (except the empty .env.example)
 *   2. No credential-shaped strings in source: connection strings with passwords, API keys, tokens
 *   3. After build: no secret environment variable's value appears in .next (client or server)
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SECRET_KEYS = [
  "DATABASE_URL", "DATABASE_MIGRATION_URL", "SESSION_SECRET", "ADMIN_PASSWORD_HASH", "REVALIDATE_SECRET", "GEMINI_API_KEY",
  "GROQ_API_KEY", "BUFFER_API_KEY", "GITHUB_DISPATCH_TOKEN", "COINGECKO_DEMO_KEY",
];

const PATTERNS = [
  ["Google API key", /AIza[0-9A-Za-z_-]{35}/],
  ["Groq API key", /gsk_[0-9A-Za-z]{30,}/],
  ["GitHub token", /(ghp|gho|ghs|ghu)_[0-9A-Za-z]{30,}|github_pat_[0-9A-Za-z_]{40,}/],
  ["OpenAI-style key", /sk-(proj-)?[0-9A-Za-z_-]{32,}/],
  ["Password hash", /scrypt[:$]\d+[:$]\d+[:$]\d+[:$][A-Za-z0-9+/=]{16,}/],
  ["Private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["Secret assigned in a file", /^\s*(DATABASE_URL|DATABASE_MIGRATION_URL|SESSION_SECRET|ADMIN_PASSWORD_HASH|REVALIDATE_SECRET|GEMINI_API_KEY|GROQ_API_KEY|BUFFER_API_KEY|GITHUB_DISPATCH_TOKEN|COINGECKO_DEMO_KEY)[ \t]*=[ \t]*["']?[^\s"'#]{8,}/m],
];

const SKIP = /(^|\/)(node_modules|\.next|\.git|\.netlify)\/|package-lock\.json$|\.(png|jpe?g|gif|webp|ico|woff2?|ttf|otf|pdf|zip)$/;
const SELF = "scripts/check-secrets.mjs";

const problems = [];
const report = (file, what) => problems.push(`  ${file}: ${what}`);

function trackedFiles() {
  try {
    return execSync("git ls-files -z", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split("\0").filter(Boolean);
  } catch {
    return null; // not a git checkout (e.g. a zip): fall back to walking the folder
  }
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const rel = relative(process.cwd(), p).replaceAll("\\", "/");
    if (SKIP.test(rel + (statSync(p).isDirectory() ? "/" : ""))) continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(rel);
  }
  return out;
}

function scanSource() {
  const files = trackedFiles() ?? walk(process.cwd());
  for (const f of files) {
    const base = f.split("/").pop();
    if (/^\.env(\..+)?$/.test(base) && base !== ".env.example") {
      report(f, "environment file is committed. Remove it with `git rm --cached " + f + "` and rotate every key it contained");
      continue;
    }
    if (f === SELF || SKIP.test(f) || !existsSync(f)) continue;
    let text;
    try {
      text = readFileSync(f, "utf8");
    } catch {
      continue;
    }
    if (text.includes("\u0000")) continue; // binary
    for (const [label, re] of PATTERNS) if (re.test(text)) report(f, label);
  }
}

function scanOutput() {
  const values = SECRET_KEYS.map((k) => [k, process.env[k]?.trim()]).filter(([, v]) => v && v.length >= 8);
  if (!values.length || !existsSync(".next")) return;
  const files = [];
  const stack = [".next"];
  while (stack.length) {
    const dir = stack.pop();
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (name === "cache") continue; // build cache is never deployed
      if (statSync(p).isDirectory()) stack.push(p);
      else if (statSync(p).size < 20 * 1024 * 1024) files.push(p);
    }
  }
  for (const f of files) {
    let text;
    try {
      text = readFileSync(f, "utf8");
    } catch {
      continue;
    }
    for (const [k, v] of values) if (text.includes(v)) report(f, `contains the value of ${k}`);
  }
}

const outputMode = process.argv.includes("--output");
if (outputMode) scanOutput();
else scanSource();

if (problems.length) {
  console.error(`\n✖ Possible secret exposure (${outputMode ? "build output" : "repository"}):\n${problems.join("\n")}\n`);
  console.error("Secrets belong in .env.local (local) or your host's environment settings, never in files that are committed or built.");
  console.error("If a real key was ever committed or deployed, rotate it: removing it from the code does not remove it from git history.\n");
  process.exit(1);
}
console.log(`✓ No secrets found in the ${outputMode ? "build output" : "repository"}.`);
