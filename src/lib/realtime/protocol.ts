/**
 * Realtime protocol (Phase 6) — shared contract between the persistent worker
 * (scripts/realtime-worker.ts) and browser clients.
 *
 * No secrets, no DB, no network — pure validation so both sides agree on
 * event names, room conventions and payload shapes.
 */

export const SYMBOL_RE = /^[A-Z0-9$\-.]{1,20}$/;

export function isValidSymbol(input: unknown): boolean {
  if (typeof input !== "string") return false;
  const s = input.trim().toUpperCase();
  if (!s) return false;
  return SYMBOL_RE.test(s);
}

export const REALTIME_EVENTS = {
  MARKET_UPDATE: "market:update",
  SIGNAL_NEW: "signal:new",
  ANOMALY_NEW: "anomaly:new",
  NEWS_IMPACT: "news:impact",
  SYSTEM_STATUS: "system:status",
  ASSET_SCORE: "asset:score",
  SUBSCRIBE_ASSET: "subscribe:asset",
  UNSUBSCRIBE_ASSET: "unsubscribe:asset",
  JOIN_MEMECOINS: "join:memecoins",
} as const;

function isIsoString(v: unknown): boolean {
  if (typeof v !== "string" || !v) return false;
  const d = Date.parse(v);
  return Number.isFinite(d);
}

const SECRET_LIKE_KEYS = new Set(["token", "secret", "apiKey", "api_key", "authorization", "password"]);

export function isMarketUpdate(v: unknown): boolean {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (!Array.isArray(o.assets)) return false;
  if (typeof o.provider !== "string" || !o.provider.trim()) return false;
  if (typeof o.stale !== "boolean") return false;
  if (typeof o.fetchedAt !== "string" || (o.fetchedAt !== "" && !isIsoString(o.fetchedAt))) return false;
  // fetchedAt may be "" only when stale fallback with no cache — still considered valid shape
  // but for non-empty batches we expect ISO; empty string is allowed only when assets empty? keep permissive:
  // the strict check above already allows "" — if you want to reject "" when assets non-empty, do it here
  // For Phase 6 tests: assets.length>0 requires fetchedAt ISO, assets empty allows "".
  if (Array.isArray(o.assets) && o.assets.length > 0 && o.fetchedAt === "") return false;
  // assets entries are not deeply validated here — that belongs to AssetSnapshot schema
  return true;
}

export function isSystemStatus(v: unknown): boolean {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    if (SECRET_LIKE_KEYS.has(k)) return false;
  }
  if (o.connected !== true) return false;
  if (typeof o.stale !== "boolean") return false;
  if (!isIsoString(o.serverTime)) return false;
  if (typeof o.tickMs !== "number" || !Number.isFinite(o.tickMs) || o.tickMs <= 0) return false;
  return true;
}
