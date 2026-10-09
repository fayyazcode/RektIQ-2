import { getPostgresDb } from "./db/client";
import { globalSettings } from "./db/schema";
import { eq, sql } from "drizzle-orm";
import type { SettingsDoc } from "./types";

export const DEFAULT_SETTINGS: SettingsDoc = {
  _id: "global",
  postingEnabled: true,
  requireApproval: false,
  postsPerDay: 3,
  postTimesUtc: ["13:00", "17:00", "21:00"],
  postWindowStartUtc: "08:00",
  postWindowEndUtc: "22:00",
  disabledSources: [],
  breakingEnabled: true,
  breakingMaxPerDay: 3,
  breakingMinGapMinutes: 90,
  breakingSensitivity: "normal",
  postMix: { link: 50, detailed: 30, humor: 20 },
  summariesPerDay: 40,
  marketWatchlist: ["BTC", "ETH", "SOL", "XRP", "BNB", "DOGE", "ADA", "LINK", "AVAX", "POL"],
  degenMaxMarketCap: 500_000_000,
  xSignalThreshold: 75,
  updatedAt: new Date(0),
};

/** Uppercase, validated ticker symbols (same shape the realtime worker accepts). */
const SYMBOL_RE = /^[A-Z0-9$\-.]{1,20}$/;
export function normalizeWatchlist(input: unknown): string[] | null {
  if (!Array.isArray(input)) return null;
  const out = [...new Set(input.map((s) => String(s).trim().toUpperCase()).filter((s) => SYMBOL_RE.test(s)))];
  return out.length ? out.slice(0, 60) : [];
}

/** jsonb stores dates as ISO strings; coerce them back to Date values. */
function toDate(v: unknown): Date | undefined {
  if (v instanceof Date) return v;
  if (typeof v === "string" || typeof v === "number") {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return undefined;
}

export async function getSettings(): Promise<SettingsDoc> {
  const db = getPostgresDb();
  const rows = await db.select({ value: globalSettings.value }).from(globalSettings).where(eq(globalSettings.key, "global")).limit(1);
  const stored = rows[0]?.value as Record<string, unknown> | undefined;
  if (!stored) return { ...DEFAULT_SETTINGS };
  const merged = { ...DEFAULT_SETTINGS, ...stored } as SettingsDoc;
  merged.updatedAt = toDate(stored.updatedAt) ?? DEFAULT_SETTINGS.updatedAt;
  if (stored.lastPostSyncAt !== undefined) {
    merged.lastPostSyncAt = toDate(stored.lastPostSyncAt) ?? null;
  }
  return merged;
}

export async function saveSettings(patch: Partial<Omit<SettingsDoc, "_id">>) {
  const db = getPostgresDb();
  const now = new Date();
  const value = { ...patch, updatedAt: now.toISOString() } as Record<string, unknown>;
  await db
    .insert(globalSettings)
    .values({ key: "global", value, updatedAt: now })
    .onConflictDoUpdate({
      target: globalSettings.key,
      // Shallow jsonb merge updates the singleton settings row.
      set: { value: sql`${globalSettings.value} || excluded.value`, updatedAt: sql`excluded.updated_at` },
    });
}
