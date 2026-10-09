import { getDegenRadar } from "@/lib/data/intel-queries";
import { formatPriceChange } from "@/lib/intel/format";
import { ScoreBadge } from "@/components/intel/MarketTable";
import PageHero from "@/components/PageHero";
import { Sparkline } from "@/components/intel/Sparkline";
import { ClickableCoinRow } from "@/components/intel/ClickableCoinRow";
import Link from "next/link";
export const dynamic = "force-dynamic";
export default async function DegenPage({ searchParams }: { searchParams: Promise<Record<string,string>> }) {
  const qp = await searchParams;
  const maxMcap = qp.maxMarketCap ? Number(qp.maxMarketCap) : 500_000_000;
  const rows = await getDegenRadar(maxMcap);
  return (
    <div className="space-y-6">
      <PageHero variant="degen" kicker={<><span aria-hidden="true">$ </span>scan small caps</>} title="Degen Radar"><p className="text-sm md:text-base leading-relaxed">Filters tracked assets below the selected market-cap ceiling (${maxMcap.toLocaleString()} by default), then ranks them by 24-hour trading volume divided by market cap. A higher ratio means more trading relative to the asset&apos;s size—it can signal heightened activity and volatility, not quality or a recommendation.</p><p className="text-xs text-amber-300 mt-2">Change the ceiling with ?maxMarketCap=1000000000. Not investment advice.</p></PageHero>
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm sm:text-xs">
            <thead className="text-left text-muted font-mono text-xs">
              <tr><th className="py-2 pr-3">Asset</th><th className="py-2 pr-3">Price</th><th className="py-2 pr-3">24h</th><th className="py-2 pr-3">7d trend</th><th className="py-2 pr-3">Score</th><th className="py-2">Vol/MCap</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <ClickableCoinRow key={r.symbol} href={`/market/${r.symbol}`} label={`${r.symbol} ${r.name}`} className="border-t border-line">
                  <td className="py-2 pr-3"><Link href={`/market/${r.symbol}`} className="font-mono font-semibold no-underline hover:underline">{r.symbol}</Link> <span className="text-muted text-xs">{r.name}</span> {r.anomaly ? <span className="chip text-amber-300 border-amber-300/30 text-xs">{r.anomaly}</span> : null}</td>
                  <td className="py-2 pr-3 font-mono">${r.price < 1 ? r.price.toFixed(4) : r.price.toLocaleString()}</td>
                  <td className={`py-2 pr-3 font-mono ${r.priceChange24h >= 0 ? "text-emerald-400" : "text-red-400"}`}>{formatPriceChange(r.priceChange24h)}</td>
                  <td className="py-2 pr-3"><Sparkline values={r.sparkline7d} symbol={r.symbol} /></td>
                  <td className="py-2 pr-3"><ScoreBadge score={r.score} estimated={r.scoreEstimated} /></td>
                  <td className="py-2 font-mono text-muted" title={r.volumeQuality === "outlier" ? "Provider-reported volume exceeds 10× market cap and is excluded as an outlier." : "24-hour volume divided by market cap."}>
                    {r.volumeQuality === "outlier" ? <span className="chip text-amber-300 border-amber-300/30">Outlier</span> : r.marketCap > 0 && r.volume24h === 0 ? "—" : `${r.volMcapRatio.toFixed(4)}×`}
                  </td>
                </ClickableCoinRow>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="text-sm text-muted">No degen candidates at this cap. Try a higher maxMarketCap.</p>}
    </div>
  );
}
