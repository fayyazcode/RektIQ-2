import { formatScore, scoreTone, formatPriceChange } from "@/lib/intel/format";
import type { AssetView } from "@/lib/data/intel-queries";
import { Sparkline } from "./Sparkline";
import { ClickableCoinRow } from "./ClickableCoinRow";
import Link from "next/link";

export function ScoreBadge({ score, estimated = false }: { score: number | null; estimated?: boolean }) {
  if (score == null) return <span className="chip text-muted">—</span>;
  const tone = scoreTone(score);
  const cls = tone === "bullish" ? "text-emerald-400 border-emerald-400/30" : tone === "bearish" ? "text-red-400 border-red-400/30" : "text-zinc-400 border-zinc-600";
  return <span className={`chip border ${cls}`} title={estimated ? "Estimated from the current market snapshot; historical volume baseline and news activity are not available." : "Score calculated and stored by the realtime worker."}>{estimated ? "~" : ""}{formatScore(score)}/100{estimated ? " est." : ""}</span>;
}

export function MarketTable({ assets, stale }: { assets: AssetView[]; stale?: boolean }) {
  if (!assets.length) return <p className="text-muted text-sm">No market data yet. Check back after the next tick, or set DATABASE_URL and REALTIME_URL.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-muted font-mono text-xs">
          <tr>
            <th className="py-2 pr-3">Asset</th>
            <th className="py-2 pr-3">Price</th>
            <th className="py-2 pr-3">24h</th>
            <th className="py-2 pr-3">7d trend</th>
            <th className="py-2 pr-3">Score</th>
            <th className="py-2">Vol / MCap</th>
          </tr>
        </thead>
        <tbody>
          {assets.map((a) => (
            <ClickableCoinRow key={a.symbol} href={`/market/${a.symbol}`} label={`${a.symbol} ${a.name}`} className="border-t border-line">
              <td className="py-2 pr-3">
                <Link href={`/market/${a.symbol}`} className="font-mono font-semibold no-underline hover:underline">
                  {a.symbol}
                </Link>{" "}
                <span className="text-muted text-xs">{a.name}</span>
              </td>
              <td className="py-2 pr-3 font-mono">${a.price < 1 ? a.price.toFixed(4) : a.price.toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
              <td className={`py-2 pr-3 font-mono ${a.priceChange24h >= 0 ? "text-emerald-400" : "text-red-400"}`}>{formatPriceChange(a.priceChange24h)}</td>
              <td className="py-2 pr-3"><Sparkline values={a.sparkline7d} symbol={a.symbol} /></td>
              <td className="py-2 pr-3">
                <ScoreBadge score={a.score} estimated={a.scoreEstimated} />
              </td>
              <td className="py-2 font-mono text-muted" title={a.volumeQuality === "outlier" ? "Provider-reported volume exceeds 10× market cap and is excluded as an outlier." : "24-hour volume divided by market cap."}>
                {a.volumeQuality === "outlier" ? <span className="chip text-amber-300 border-amber-300/30">Outlier</span> : a.marketCap > 0 && a.volume24h === 0 ? "—" : `${a.liquidity.toFixed(4)}×`}
              </td>
            </ClickableCoinRow>
          ))}
        </tbody>
      </table>
      {stale ? <p className="mt-2 text-xs text-amber-300">Showing cached data (stale) — provider may be rate-limited.</p> : null}
    </div>
  );
}
