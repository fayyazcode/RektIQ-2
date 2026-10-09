import { config } from "@/lib/env";
import { getOverview, listAnomalies, listSignals } from "@/lib/data/intel-queries";
import { hasDatabase } from "@/lib/db";
import { MarketTable } from "@/components/intel/MarketTable";
import Link from "next/link";
import PageHero from "@/components/PageHero";

export const dynamic = "force-dynamic";

function intelEnabled() {
  return config("FEATURE_MARKET_INTEL", "false") === "true" || config("FEATURE_MARKET_INTEL") === "1";
}

export default async function MarketPage() {
  const overview = await getOverview();
  const [signals, anomalies] = await Promise.all([listSignals({ limit: 10 }), listAnomalies({ limit: 10 })]);
  const enabled = intelEnabled();
  const dbOk = hasDatabase();
  return (
    <div className="space-y-6 sm:space-y-8">
      <PageHero variant="market" kicker={<><span aria-hidden="true">$ </span>watch market --live</>} title="Live Market">
        <p className="text-muted text-sm mt-1">Provider: {overview.provider} · {overview.stale ? "stale" : "live"} · {overview.fetchedAt ? new Date(overview.fetchedAt).toLocaleString() : "—"} · {overview.breadth.up} up / {overview.breadth.down} down</p>
        {!enabled ? <p className="text-xs text-amber-300 mt-2">Market intelligence is behind FEATURE_MARKET_INTEL. Set it to true to enable.</p> : null}
        {!dbOk && enabled ? <p className="text-xs text-amber-300 mt-2">Database not connected. Set DATABASE_URL to your Supabase PostgreSQL connection string and run npm run job:realtime.</p> : null}
      </PageHero>
      <section aria-labelledby="market-guide-title" className="space-y-3">
        <div>
          <p className="font-term text-xl leading-none text-phosphor">quick guide</p>
          <h2 id="market-guide-title" className="mt-1 font-mono text-xl font-semibold">How to read the market</h2>
          <p className="text-sm text-muted">A short guide to the two metrics shown in the market table.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <article className="panel rounded-xl p-5 md:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-mono text-xs uppercase tracking-wider text-phosphor">Composite metric</p>
                <h3 className="mt-1 font-mono text-lg font-semibold">Live Score</h3>
              </div>
              <span className="font-mono text-2xl text-phosphor">0–100</span>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-muted">A weighted blend of seven market factors. It summarizes current conditions; it is not a prediction or a trade recommendation.</p>
            <ul className="mt-4 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              <li className="flex justify-between gap-2 rounded border border-line px-3 py-2"><span>Momentum</span><span className="font-mono text-muted">25%</span></li>
              <li className="flex justify-between gap-2 rounded border border-line px-3 py-2"><span>Volume vs. baseline</span><span className="font-mono text-muted">20%</span></li>
              <li className="flex justify-between gap-2 rounded border border-line px-3 py-2"><span>Turnover</span><span className="font-mono text-muted">15%</span></li>
              <li className="flex justify-between gap-2 rounded border border-line px-3 py-2"><span>Volatility</span><span className="font-mono text-muted">10%</span></li>
              <li className="flex justify-between gap-2 rounded border border-line px-3 py-2"><span>Market-cap context</span><span className="font-mono text-muted">10%</span></li>
              <li className="flex justify-between gap-2 rounded border border-line px-3 py-2"><span>Moving-average position</span><span className="font-mono text-muted">10%</span></li>
              <li className="flex justify-between gap-2 rounded border border-line px-3 py-2 sm:col-span-2"><span>News / social activity</span><span className="font-mono text-muted">10%</span></li>
            </ul>
            <p className="mt-3 text-xs text-muted">Bands: bearish 0–35 · neutral 36–64 · bullish 65–100.</p>
          </article>
          <article className="panel rounded-xl p-5 md:p-6">
            <p className="font-mono text-xs uppercase tracking-wider text-cyan">Daily turnover</p>
            <h3 className="mt-1 font-mono text-lg font-semibold">Vol/MCap</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted">24-hour dollar trading volume divided by market capitalization. It estimates how much trading happened relative to the asset&apos;s size.</p>
            <div className="mt-4 rounded-lg border border-line bg-black/40 p-4">
              <p className="text-xs uppercase tracking-wider text-muted">Formula</p>
              <p className="mt-1 font-mono text-sm">24h volume ÷ market cap</p>
              <p className="mt-3 text-xs uppercase tracking-wider text-muted">Example</p>
              <p className="mt-1 text-sm"><span className="font-mono text-cyan">0.01 = 1%</span> of market cap traded in 24 hours.</p>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-muted">Higher turnover means more trading relative to market cap. It does not measure order-book depth or guarantee easy execution.</p>
          </article>
        </div>
      </section>
      <section className="panel p-4 md:p-6">
        <MarketTable assets={overview.assets} stale={overview.stale} />
        {overview.error ? <p className="text-xs text-red-400 mt-2">{overview.error}</p> : null}
      </section>
      <div className="grid gap-4 sm:gap-6 md:grid-cols-2">
        <section className="panel p-4">
          <h2 className="font-mono font-semibold text-sm mb-3">Recent signals <Link href="/signals" className="text-xs font-normal">view all</Link></h2>
          {!dbOk ? <p className="text-xs text-zinc-500">Database not configured.</p> : signals.length ? <ul className="space-y-2 text-sm">{signals.map((s) => <li key={s.id}><Link href={`/signals/${s.id}`} className="list-card-motion flex justify-between gap-3 border-t border-line pt-2 no-underline"><span className="font-mono">{s.symbol} · {s.type}</span><span className="text-muted">{s.score}/100 · details</span></Link></li>)}</ul> : <p className="text-sm text-muted">No signals yet.</p>}
        </section>
        <section className="panel p-4">
          <h2 className="font-mono font-semibold text-sm mb-3">Recent anomalies <Link href="/anomalies" className="text-xs font-normal">view all</Link></h2>
          {!dbOk ? <p className="text-xs text-zinc-500">Database not configured.</p> : anomalies.length ? <ul className="space-y-2 text-sm">{anomalies.map((a) => <li key={a.id}><Link href={`/market/${a.symbol}`} className="list-card-motion flex justify-between gap-3 border-t border-line pt-2 no-underline"><span className="font-mono">{a.symbol} · {a.type}</span><span className="text-muted">{a.severity}</span></Link></li>)}</ul> : <p className="text-sm text-muted">No anomalies yet.</p>}
        </section>
      </div>
      <p className="text-xs text-muted">Scores are statistics, not investment advice. Nothing here is a trade signal.</p>
    </div>
  );
}
