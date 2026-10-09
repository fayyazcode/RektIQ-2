import { getAssetDetail } from "@/lib/data/intel-queries";
import { ScoreBadge } from "@/components/intel/MarketTable";
import { formatPriceChange } from "@/lib/intel/format";
import { notFound } from "next/navigation";
import PageHero from "@/components/PageHero";
import { PriceHistoryChart } from "@/components/intel/PriceHistoryChart";
import { getHistory } from "@/lib/market/service";
import { isValidSymbol } from "@/lib/realtime/protocol";
import Time from "@/components/Time";
import Link from "next/link";
export const dynamic = "force-dynamic";
export default async function AssetPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const upper = symbol.toUpperCase();
  if (!isValidSymbol(upper)) notFound();
  const [{ asset, signals, chartSignals, anomalies, newsImpacts }, history] = await Promise.all([
    getAssetDetail(upper),
    getHistory(upper, "24h"),
  ]);
  if (!asset) return notFound();
  return (
    <div className="space-y-6">
      <PageHero variant="asset" kicker={<><span aria-hidden="true">$ </span>inspect {asset.symbol}</>} title={`${asset.symbol} — ${asset.name}`}>
        <p className="text-muted text-sm">${asset.price.toLocaleString()} · {formatPriceChange(asset.priceChange24h)} · <ScoreBadge score={asset.score} estimated={asset.scoreEstimated} /></p>
        <p className="text-xs text-muted">Provider {asset.provider} · {new Date(asset.timestamp).toLocaleString()}</p>
      </PageHero>
      <PriceHistoryChart key={asset.symbol} symbol={asset.symbol} initialPoints={history.points} initialStale={history.stale} initialQuote={{ t: asset.timestamp, price: asset.price }} initialSignals={chartSignals} />
      <section className="panel p-4">
        <h2 className="font-mono text-sm font-semibold mb-2">Signals</h2>
        {signals.length ? <ul className="space-y-1 text-sm">{signals.map(s => (
          <li key={s.id} className="border-t border-line py-2">
            <Link href={`/signals/${s.id}`} className="block no-underline hover:text-phosphor">
              <p className="m-0 font-mono">{s.type.replace(/_/g, " ")} · {s.score}/100 · details</p>
              <p className="m-0 mt-1 text-xs text-muted">Triggered <Time iso={s.timestamp} /></p>
            </Link>
          </li>
        ))}</ul> : <p className="text-sm text-muted">No signals.</p>}
      </section>
      <section className="panel p-4">
        <h2 className="font-mono text-sm font-semibold mb-2">Anomalies</h2>
        {anomalies.length ? <ul className="text-sm space-y-1">{anomalies.map(a => (
          <li key={a.id} className="border-t border-line py-2">
            <p className="font-mono">{a.type} · {a.severity}</p>
            <p className="text-xs text-muted">Detected <Time iso={a.timestamp} /></p>
          </li>
        ))}</ul> : <p className="text-sm text-muted">No anomalies.</p>}
      </section>
      <section className="panel p-4">
        <h2 className="font-mono text-sm font-semibold mb-2">News impact</h2>
        {newsImpacts.length ? <ul className="text-sm space-y-1">{newsImpacts.map(n => (
          <li key={n.id} className="border-t border-line py-2">
            <p>{n.headline} · {n.priceChangePct}%</p>
            <p className="text-xs text-muted">Published <Time iso={n.publishedAt} /> · Impact calculated <Time iso={n.computedAt} /></p>
          </li>
        ))}</ul> : <p className="text-sm text-muted">No impacts yet.</p>}
      </section>
      <p className="text-xs text-muted">Observed movements after publication — correlation, not causation. Not investment advice.</p>
    </div>
  );
}
