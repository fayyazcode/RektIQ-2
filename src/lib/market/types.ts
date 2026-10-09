/**
 * Normalized market data types. UI and business logic use ONLY these shapes —
 * never a provider's raw response (see docs/MARKET.md). Every record carries a
 * timestamp and provider metadata so freshness and provenance are always known.
 */

export type AssetSnapshot = {
  symbol: string; // uppercase ticker, e.g. "BTC"
  name: string;
  price: number; // USD
  priceChange24h: number; // percent, e.g. -2.5 means −2.5 %
  marketCap: number; // USD (0 when unknown)
  volume24h: number; // USD (0 when unknown)
  liquidity: number; // USD volume/market-cap ratio proxy (0 when unknown)
  volumeQuality?: "outlier"; // provider volume was excluded as an implausible outlier
  high24h?: number;
  low24h?: number;
  ath?: number;
  circulatingSupply?: number;
  totalSupply?: number;
  maxSupply?: number;
  fdv?: number; // fully diluted valuation
  rank?: number;
  sparkline7d?: number[]; // 7-day price series, when the provider gives one
  timestamp: string; // ISO time the provider data refers to
  provider: string; // e.g. "coingecko"
};

export type HistoricalPoint = {
  t: string; // ISO timestamp of the sample
  price: number;
  volume: number | null;
};

/** Timeframes the market layer supports; providers map these to their own granularity. */
export type Timeframe = "1h" | "24h" | "7d" | "30d" | "90d";

export const TIMEFRAMES: Timeframe[] = ["1h", "24h", "7d", "30d", "90d"];

/** How many days of history a timeframe needs (CoinGecko `days` parameter style). */
export const TIMEFRAME_DAYS: Record<Timeframe, number> = {
  "1h": 1,
  "24h": 1,
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

export interface MarketProvider {
  /** Stable identifier, stored in records as `provider`. */
  readonly id: string;
  /** All assets this provider knows about (tracked universe). */
  getAssets(): Promise<AssetSnapshot[]>;
  /** Snapshot for a set of symbols; missing symbols are simply absent from the result. */
  getMarketSnapshot(symbols: string[]): Promise<AssetSnapshot[]>;
  /** Price/volume history for one symbol over a timeframe. */
  getHistoricalData(symbol: string, timeframe: Timeframe): Promise<HistoricalPoint[]>;
}

/** A snapshot batch plus the metadata the API/realtime layer forwards to clients. */
export type MarketBatch = {
  assets: AssetSnapshot[];
  fetchedAt: string;
  provider: string;
  /** true when served from cache because the provider failed or is rate-limited */
  stale: boolean;
  error?: string;
};
