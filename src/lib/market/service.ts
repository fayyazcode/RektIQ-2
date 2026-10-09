/**
 * Market service: the single funnel for market data on both the Next.js server
 * and the realtime worker. Browsers never call providers; they hit /api/market/*
 * or receive Socket.IO events built from this service.
 *
 * Responsibilities: provider selection, TTL caching, single-flight de-dup,
 * rate-limit back-off, stale-while-error fallback, health tracking.
 */
import { config } from "../env";
import { createMarketProvider, RateLimitedError } from "./coingecko";
import { singleFlight, TtlCache } from "./cache";
import { HealthTracker } from "./health";
import type { AssetSnapshot, HistoricalPoint, MarketBatch, MarketProvider, Timeframe } from "./types";

export const MARKET_TTL_MS = 60_000; // fresh window for snapshot batches
export const HISTORY_TTL_MS = 5 * 60_000;
const BACKOFF_MS = 90_000; // after a 429, don't touch the provider for a while

const cache = new TtlCache();
const flights = new Map<string, Promise<unknown>>();
const health = new HealthTracker();
let backoffUntil = 0;

let providerOverride: MarketProvider | null = null;
/** Test seam: swap in a fake provider. Pass null to restore config-based creation. */
export function setMarketProvider(p: MarketProvider | null) {
  providerOverride = p;
}

export function getMarketProvider(): MarketProvider {
  return providerOverride ?? createMarketProvider(config("MARKET_PROVIDER", "coingecko"));
}

export function resetMarketService(now = Date.now()) {
  cache.clear();
  flights.clear();
  backoffUntil = 0;
  health.reset();
  void now;
}

export function marketHealth() {
  return health.snapshot(getMarketProvider().id);
}

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const start = Date.now();
  const value = await fn();
  return { value, ms: Date.now() - start };
}

function failureToMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Latest tracked-market snapshot. Never throws: falls back to stale cache + flag. */
export async function getMarketBatch(symbols?: string[]): Promise<MarketBatch> {
  const provider = getMarketProvider();
  const key = `batch:${symbols ? [...symbols].map((s) => s.toUpperCase()).sort().join(",") : "all"}`;
  const cached = cache.get<AssetSnapshot[]>(key);
  if (cached && Date.now() >= backoffUntil) {
    return { assets: cached, fetchedAt: keyFetchedAt(key) ?? new Date().toISOString(), provider: provider.id, stale: false };
  }
  try {
    if (Date.now() < backoffUntil) throw new Error("provider in rate-limit back-off");
    const { value, ms } = await timed(async () =>
      symbols !== undefined ? provider.getMarketSnapshot(symbols) : provider.getAssets()
    );
    health.recordSuccess(ms);
    cache.set(key, value, MARKET_TTL_MS);
    cache.set(`fetchedAt:${key}`, new Date().toISOString(), MARKET_TTL_MS * 10);
    return { assets: value, fetchedAt: keyFetchedAt(key)!, provider: provider.id, stale: false };
  } catch (err) {
    const isRate = err instanceof RateLimitedError;
    if (isRate) backoffUntil = Date.now() + Math.min(err.retryAfterMs || BACKOFF_MS, 5 * 60_000);
    else if (failureToMessage(err).includes("rate")) backoffUntil = Date.now() + BACKOFF_MS;
    health.recordError(0, failureToMessage(err), isRate);
    const staleValue = cache.getStale<AssetSnapshot[]>(key);
    if (staleValue) {
      return {
        assets: staleValue,
        fetchedAt: keyFetchedAt(key) ?? "",
        provider: provider.id,
        stale: true,
        error: failureToMessage(err),
      };
    }
    return { assets: [], fetchedAt: "", provider: provider.id, stale: true, error: failureToMessage(err) };
  }
}

function keyFetchedAt(key: string): string | undefined {
  return cache.getStale<string>(`fetchedAt:${key}`);
}

/** History for one symbol; errors surface as empty arrays with health recorded. */
export async function getHistory(symbol: string, timeframe: Timeframe): Promise<{ points: HistoricalPoint[]; stale: boolean; error?: string }> {
  const provider = getMarketProvider();
  const key = `hist:${symbol.toUpperCase()}:${timeframe}`;
  const cached = cache.get<HistoricalPoint[]>(key);
  if (cached) return { points: cached, stale: false };
  try {
    if (Date.now() < backoffUntil) throw new Error("provider in rate-limit back-off");
    const { value, ms } = await timed(() => provider.getHistoricalData(symbol, timeframe));
    health.recordSuccess(ms);
    cache.set(key, value, HISTORY_TTL_MS);
    return { points: value, stale: false };
  } catch (err) {
    health.recordError(0, failureToMessage(err), err instanceof RateLimitedError);
    const staleValue = cache.getStale<HistoricalPoint[]>(key);
    if (staleValue) return { points: staleValue, stale: true, error: failureToMessage(err) };
    return { points: [], stale: true, error: failureToMessage(err) };
  }
}

/** Single-flight wrapper so concurrent requests for the same key share one fetch. */
export async function loadOnce<T>(key: string, fn: () => Promise<T>): Promise<T> {
  return singleFlight(flights as Map<string, Promise<unknown>>, key, fn) as Promise<T>;
}
