"use client";

import { useEffect, useState } from "react";
import { getMarketBatch } from "@/lib/market/service";
import { formatPriceChange, formatScore, scoreTone } from "@/lib/intel/format";
import { useRealtimeOptional } from "@/components/realtime/RealtimeProvider";

type PulseAsset = {
  symbol: string;
  name: string;
  price: number;
  priceChange24h: number;
  marketCap: number;
  volume24h: number;
  liquidity: number;
  volumeQuality?: "outlier";
  fdv?: number;
  rank?: number;
  sparkline7d?: number[];
  timestamp: string;
  provider: string;
};

export function MarketPulse() {
  const [assets, setAssets] = useState<PulseAsset[]>([]);
  const [stale, setStale] = useState(false);
  const rt = useRealtimeOptional();

  useEffect(() => {
    async function load() {
      const batch = await getMarketBatch(undefined);
      setAssets(
        batch.assets.map((a) => ({
          symbol: a.symbol,
          name: a.name,
          price: a.price,
          priceChange24h: a.priceChange24h,
          marketCap: a.marketCap,
          volume24h: a.volume24h,
          liquidity: a.liquidity,
          volumeQuality: a.volumeQuality,
          fdv: a.fdv,
          rank: a.rank,
          sparkline7d: a.sparkline7d,
          timestamp: a.timestamp,
          provider: a.provider,
        }))
      );
      setStale(batch.stale);
    }
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);

  if (!rt) return null;

  return (
    <div className="space-y-4">
      {/* Realtime status bar */}
      <div className="flex items-center gap-2 text-xs text-zinc-400">
        <span className="h-2 w-2 rounded-full">
          {rt.status === "connected"
            ? "bg-emerald-500"
            : rt.status === "connecting"
            ? "bg-amber-500 animate-pulse"
            : "bg-zinc-500"}
        </span>
        {rt.status === "connected"
          ? rt.stale
            ? "Live · stale"
            : "Live"
          : rt.status === "connecting"
          ? "Connecting…"
          : "Offline"}
      </div>

      {/* Market table */}
      {assets.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-border sm:text-xs">
            <thead className="text-left text-muted font-mono text-xs">
              <tr>
                <th className="py-2 pr-3">Asset</th>
                <th className="py-2 pr-3">Price</th>
                <th className="py-2 pr-3">24h</th>
                <th className="py-2 pr-3">Score</th>
                <th className="py-2">Vol / MCap</th>
              </tr>
            </thead>
            <tbody>
              {assets.map((a) => (
                <tr key={a.symbol} className="border-t border-line">
                  <td className="py-2 pr-3">
                    <a href={`/market/${a.symbol}`} className="font-mono font-semibold no-underline hover:underline">
                      {a.symbol}
                    </a>{" "}
                    <span className="text-muted text-xs">{a.name}</span>
                  </td>
                  <td className="py-2 pr-3 font-mono">
                    {a.price < 1 ? a.price.toFixed(4) : a.price.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                  </td>
                  <td className={`py-2 pr-3 font-mono ${a.priceChange24h >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {formatPriceChange(a.priceChange24h)}
                  </td>
                  <td className="py-2 pr-3">
                    <span className="chip text-muted">—</span>
                  </td>
                  <td className="py-2 font-mono text-muted" title={a.volumeQuality === "outlier" ? "Provider-reported volume exceeds 10× market cap and is excluded as an outlier." : "24-hour volume divided by market cap."}>
                    {a.volumeQuality === "outlier" ? <span className="chip text-amber-300 border-amber-300/30">Outlier</span> : a.marketCap > 0 && a.volume24h === 0 ? "—" : `${a.liquidity.toFixed(4)}×`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-muted text-sm">Loading market data…</p>
      )}

      {/* Stale indicator */}
      {stale && !assets.length && (
        <p className="mt-2 text-xs text-amber-300 text-center">
          Showing cached data (stale) — provider may be rate-limited.
        </p>
      )}
    </div>
  );
}
