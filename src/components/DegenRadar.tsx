"use client";

import { useEffect, useState } from "react";
import { getDegenRadar } from "@/lib/data/intel-queries";
import { DegenRow } from "@/lib/data/intel-queries";
import { formatPriceChange } from "@/lib/intel/format";
import { useRealtimeOptional } from "@/components/realtime/RealtimeProvider";

export function DegenRadar() {
  const [rows, setRows] = useState<DegenRow[]>([]);
  const [maxMarketCap, setMaxMarketCap] = useState(500_000_000);
  const rt = useRealtimeOptional();

  useEffect(() => {
    async function load() {
      const data = await getDegenRadar(maxMarketCap);
      setRows(data);
    }
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [maxMarketCap]);

  if (!rt) return null;

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center gap-4 flex-wrap">
        <label className="text-sm text-zinc-400" htmlFor="maxMarketCap">
          Max Market Cap (USD):
        </label>
        <input
          id="maxMarketCap"
          type="number"
          className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1 text-sm font-mono text-white w-full sm:w-48"
          value={maxMarketCap}
          onChange={(e) => setMaxMarketCap(Number(e.target.value))}
          aria-label="Maximum market cap filter"
        />
        <span className="text-xs text-zinc-500">
          Showing {rows.length} small-cap assets
        </span>
      </div>

      {/* Disclaimer */}
      <p className="text-xs text-amber-400 bg-amber-400/10 rounded px-3 py-2">
        ⚠️ High turnover small caps are volatile. Not investment advice.
      </p>

      {/* Table */}
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm sm:text-xs">
            <thead className="text-left text-muted font-mono text-xs">
              <tr>
                <th className="py-2 pr-3">Asset</th>
                <th className="py-2 pr-3">Price</th>
                <th className="py-2 pr-3">24h</th>
                <th className="py-2 pr-3">Vol / MCap</th>
                <th className="py-2 pr-3">Liquidity</th>
                <th className="py-2 pr-3">Score</th>
                <th className="py-2">Anomaly</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.symbol} className="border-t border-line">
                  <td className="py-2 pr-3">
                    <span className="font-mono font-semibold">{r.symbol}</span>
                    <span className="text-muted text-xs">{r.name}</span>
                  </td>
                  <td className="py-2 pr-3 font-mono">
                    {r.price < 1 ? r.price.toFixed(6) : r.price.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                  </td>
                  <td className={`py-2 pr-3 font-mono ${r.priceChange24h >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {formatPriceChange(r.priceChange24h)}
                  </td>
                  <td className="py-2 pr-3 font-mono text-zinc-400" title={r.volumeQuality === "outlier" ? "Provider-reported volume exceeds 10× market cap and is excluded as an outlier." : "24-hour volume divided by market cap."}>
                    {r.volumeQuality === "outlier" ? <span className="chip text-amber-300 border-amber-300/30">Outlier</span> : r.marketCap > 0 && r.volume24h === 0 ? "—" : `${r.volMcapRatio.toFixed(4)}×`}
                  </td>
                  <td className="py-2 pr-3 font-mono text-zinc-400">{r.volumeQuality === "outlier" ? "—" : r.liquidity.toFixed(4)}</td>
                  <td className="py-2 pr-3">
                    {r.score !== null ? (
                      <span className="chip text-muted">{r.score}/100</span>
                    ) : (
                      <span className="chip text-muted">—</span>
                    )}
                  </td>
                  <td className="py-2">
                    {r.anomaly ? (
                      <span className="text-xs bg-red-500/20 text-red-400 rounded px-2 py-0.5">
                        {r.anomaly}
                      </span>
                    ) : (
                      <span className="text-zinc-600 text-xs">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-muted text-sm">No small-cap assets found for the selected market cap.</p>
      )}
    </div>
  );
}
