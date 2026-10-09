/**
 * CoinGecko adapter — the only place CoinGecko's response shapes are known.
 * Everything upstream consumes AssetSnapshot / HistoricalPoint.
 *
 * Server-side only: reads COINGECKO_DEMO_KEY via lib/env (never NEXT_PUBLIC_*).
 * Browsers must never call this provider; they go through /api/market/* or Socket.IO.
 */
import { secret } from "../env";
import type { AssetSnapshot, HistoricalPoint, MarketProvider, Timeframe } from "./types";
import { TIMEFRAME_DAYS } from "./types";

const BASE = "https://api.coingecko.com/api/v3";
const FETCH_TIMEOUT_MS = 8000;
/** Guard against corrupted provider aggregates dominating scores and rankings. */
export const MAX_VOLUME_TO_MARKET_CAP_RATIO = 10;

/** Tracked universe for the market layer (id = CoinGecko id). Extend via config later. */
export const TRACKED_COINS: { id: string; symbol: string; name: string }[] = [
  { id: "bitcoin", symbol: "BTC", name: "Bitcoin" },
  { id: "ethereum", symbol: "ETH", name: "Ethereum" },
  { id: "solana", symbol: "SOL", name: "Solana" },
  { id: "ripple", symbol: "XRP", name: "XRP" },
  { id: "binancecoin", symbol: "BNB", name: "BNB" },
  { id: "dogecoin", symbol: "DOGE", name: "Dogecoin" },
  { id: "cardano", symbol: "ADA", name: "Cardano" },
  { id: "chainlink", symbol: "LINK", name: "Chainlink" },
  { id: "avalanche-2", symbol: "AVAX", name: "Avalanche" },
  { id: "polygon-ecosystem-token", symbol: "POL", name: "Polygon Ecosystem Token" },
  { id: "zcash", symbol: "ZEC", name: "Zcash" },
];

export class RateLimitedError extends Error {
  readonly retryAfterMs: number;
  constructor(retryAfterMs: number) {
    super(`CoinGecko rate limited (retry after ${Math.round(retryAfterMs / 1000)}s)`);
    this.name = "RateLimitedError";
    this.retryAfterMs = retryAfterMs;
  }
}

/** Exported so tests and other adapters can construct/validate provider rows. */
export type MarketRow = {
  id: string;
  symbol: string;
  name: string;
  current_price?: number | null;
  price_change_percentage_24h_in_currency?: number | null;
  market_cap?: number | null;
  total_volume?: number | null;
  high_24h?: number | null;
  low_24h?: number | null;
  ath?: number | null;
  circulating_supply?: number | null;
  total_supply?: number | null;
  max_supply?: number | null;
  fully_diluted_valuation?: number | null;
  market_cap_rank?: number | null;
  last_updated?: string | null;
  sparkline_in_7d?: { price?: (number | null)[] | null };
};

/** Pure normalization so it is unit-testable without network access. */
export function normalizeMarketRow(row: MarketRow): AssetSnapshot | null {
  const price = row.current_price;
  if (typeof price !== "number" || !isFinite(price) || price <= 0) return null;
  const meta = TRACKED_BY_ID.get(row.id);
  const symbol = (meta?.symbol ?? row.symbol ?? "").toUpperCase();
  if (!symbol) return null;
  const marketCap = numberOrZero(row.market_cap);
  const reportedVolume24h = numberOrZero(row.total_volume);
  const reportedVolumeRatio = marketCap > 0 ? reportedVolume24h / marketCap : 0;
  const volumeIsOutlier = reportedVolumeRatio > MAX_VOLUME_TO_MARKET_CAP_RATIO;
  const volume24h = volumeIsOutlier ? 0 : reportedVolume24h;
  const snap: AssetSnapshot = {
    symbol,
    name: row.name || meta?.name || symbol,
    price,
    priceChange24h: round2(row.price_change_percentage_24h_in_currency ?? 0),
    marketCap,
    volume24h,
    liquidity: volumeIsOutlier ? 0 : round6(reportedVolumeRatio),
    timestamp: row.last_updated ?? new Date().toISOString(),
    provider: "coingecko",
    ...(volumeIsOutlier ? { volumeQuality: "outlier" as const } : {}),
  };
  if (typeof row.high_24h === "number") snap.high24h = row.high_24h;
  if (typeof row.low_24h === "number") snap.low24h = row.low_24h;
  if (typeof row.ath === "number") snap.ath = row.ath;
  if (typeof row.circulating_supply === "number") snap.circulatingSupply = row.circulating_supply;
  if (typeof row.total_supply === "number") snap.totalSupply = row.total_supply;
  if (typeof row.max_supply === "number") snap.maxSupply = row.max_supply;
  if (typeof row.fully_diluted_valuation === "number") snap.fdv = row.fully_diluted_valuation;
  if (typeof row.market_cap_rank === "number") snap.rank = row.market_cap_rank;
  const spark = row.sparkline_in_7d?.price;
  if (Array.isArray(spark)) {
    const clean = spark.filter((v): v is number => typeof v === "number" && isFinite(v));
    if (clean.length >= 2) snap.sparkline7d = clean;
  }
  return snap;
}

const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : null);
const numberOrZero = (v: number | null | undefined) => (typeof v === "number" && isFinite(v) ? v : 0);
const round2 = (v: number) => Math.round(v * 100) / 100;
const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

/** /markets_chart shape: { prices: [[ms, price]], total_volumes: [[ms, vol]] } */
export function normalizeChart(json: unknown, timeframe: Timeframe): HistoricalPoint[] {
  const prices = (json as { prices?: unknown })?.prices;
  if (!Array.isArray(prices)) return [];
  const volumes = (json as { total_volumes?: unknown })?.total_volumes;
  const volByTs = new Map<number, number>();
  if (Array.isArray(volumes)) {
    for (const v of volumes) {
      if (Array.isArray(v) && typeof v[0] === "number") {
        const val = num(v[1]);
        if (val !== null) volByTs.set(v[0], val);
      }
    }
  }
  // For short windows CoinGecko returns minute-level points; thin to ≤ ~120 samples
  const step = Math.max(1, Math.floor(prices.length / 120));
  const out: HistoricalPoint[] = [];
  for (let i = 0; i < prices.length; i += step) {
    const p = prices[i];
    if (!Array.isArray(p)) continue;
    const ts = num(p[0]);
    const price = num(p[1]);
    if (ts === null || price === null || price <= 0) continue;
    out.push({ t: new Date(ts).toISOString(), price, volume: volByTs.get(ts) ?? null });
  }
  // always include the newest point
  const last = prices[prices.length - 1];
  if (out.length && Array.isArray(last)) {
    const ts = num(last[0]);
    const price = num(last[1]);
    if (ts !== null && price !== null && out[out.length - 1].t !== new Date(ts).toISOString()) {
      out.push({ t: new Date(ts).toISOString(), price, volume: volByTs.get(ts) ?? null });
    }
  }
  void timeframe;
  return out;
}

const TRACKED_BY_ID = new Map(TRACKED_COINS.map((c) => [c.id, c]));
const SYMBOL_TO_ID = new Map(TRACKED_COINS.map((c) => [c.symbol, c.id]));

/**
 * Dynamic symbol → CoinGecko id resolution for symbols outside the built-in
 * list (e.g. added through the admin watchlist). Uses the coin_list endpoint
 * (one cheap request, cached for 24 h via a bounded in-process map). Unknown
 * symbols are skipped — never guessed — and the mapping is capped so it can't
 * grow unbounded.
 */
let slugMap: Map<string, string> | null = null;
let slugMapAt = 0;
const SLUG_MAP_TTL_MS = 24 * 3600_000;
async function ensureSlugMap(): Promise<Map<string, string>> {
  if (!slugMap || Date.now() - slugMapAt > SLUG_MAP_TTL_MS) {
    const res = await cgFetch("/coins/list");
    const rows = (await res.json()) as { id: string; symbol?: string; name?: string }[];
    const m = new Map<string, string>();
    if (Array.isArray(rows)) {
      for (const r of rows) {
        const sym = String(r.symbol ?? "").toUpperCase();
        if (sym && !m.has(sym) && typeof r.id === "string") m.set(sym, r.id);
      }
    }
    slugMap = m;
    slugMapAt = Date.now();
  }
  return slugMap;
}
async function resolveIds(symbols: string[]): Promise<{ ids: string[]; missing: string[] }> {
  const ids: string[] = [];
  const missing: string[] = [];
  for (const s of symbols) {
    const known = SYMBOL_TO_ID.get(s);
    if (known) ids.push(known);
    else missing.push(s);
  }
  if (missing.length) {
    const map = await ensureSlugMap();
    for (const s of missing) {
      const id = map.get(s);
      if (id) {
        if (SYMBOL_TO_ID.size < 500) SYMBOL_TO_ID.set(s, id); // bounded cache
        ids.push(id);
      }
    }
  }
  return { ids, missing };
}

async function cgFetch(pathAndQuery: string): Promise<Response> {
  const key = secret("COINGECKO_DEMO_KEY");
  const res = await fetch(`${BASE}${pathAndQuery}`, {
    headers: key ? { "x-cg-demo-api-key": key } : {},
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: "no-store", // caching is handled by our own TTL cache, not the Next fetch cache
  });
  if (res.status === 429) {
    const ra = Number(res.headers.get("retry-after"));
    throw new RateLimitedError(isFinite(ra) && ra > 0 ? ra * 1000 : 60_000);
  }
  if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
  return res;
}

export class CoinGeckoProvider implements MarketProvider {
  readonly id = "coingecko";

  /** Top coins by market cap — powers the Degen Radar discovery set. */
  async getAssets(): Promise<AssetSnapshot[]> {
    const res = await cgFetch("/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1&sparkline=true&price_change_percentage=24h");
    const rows = (await res.json()) as MarketRow[];
    if (!Array.isArray(rows)) return [];
    return rows.map(normalizeMarketRow).filter((r): r is AssetSnapshot => r !== null);
  }

  async getMarketSnapshot(symbols: string[]): Promise<AssetSnapshot[]> {
    const wanted = symbols.map((s) => s.toUpperCase());
    const { ids } = await resolveIds(wanted);
    if (!ids.length) return [];
    const res = await cgFetch(
      `/coins/markets?vs_currency=usd&ids=${encodeURIComponent(ids.join(","))}&sparkline=true&price_change_percentage=24h`
    );
    const rows = (await res.json()) as MarketRow[];
    if (!Array.isArray(rows)) return [];
    return rows.map(normalizeMarketRow).filter((r): r is AssetSnapshot => r !== null);
  }

  async getHistoricalData(symbol: string, timeframe: Timeframe): Promise<HistoricalPoint[]> {
    const id = SYMBOL_TO_ID.get(symbol.toUpperCase()) ?? (await ensureSlugMap()).get(symbol.toUpperCase());
    if (!id) return [];
    const days = TIMEFRAME_DAYS[timeframe];
    const res = await cgFetch(`/coins/${encodeURIComponent(id)}/market_chart?vs_currency=usd&days=${days}`);
    return normalizeChart(await res.json(), timeframe);
  }
}

/** Registry-style factory so a second provider can be swapped in via config. */
export function createMarketProvider(name = "coingecko"): MarketProvider {
  switch (name) {
    case "coingecko":
      return new CoinGeckoProvider();
    default:
      throw new Error(`Unknown market provider "${name}"`);
  }
}
