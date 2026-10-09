import { listSignals } from "@/lib/data/intel-queries";
import { hasDatabase } from "@/lib/db";
import { SignalFeed } from "@/components/SignalFeed";
import PageHero from "@/components/PageHero";
export const dynamic = "force-dynamic";

export default async function SignalsPage({ searchParams }: { searchParams: Promise<Record<string,string>> }) {
  const qp = await searchParams;
  const signals = await listSignals({ symbol: qp.symbol, type: qp.type, limit: qp.limit ? Number(qp.limit) : 30 });
  const apiQuery = new URLSearchParams(
    Object.entries(qp).flatMap(([key, value]) => value ? [[key, value]] : []),
  ).toString();
  const dbOk = hasDatabase();
  return (
    <div className="space-y-6">
      <PageHero variant="signals" kicker={<><span aria-hidden="true">$ </span>watch thresholds</>} title="Signals">
        <p className="text-sm md:text-base leading-relaxed">Bullish and bearish alerts look for an accelerating move across 15-minute and 1-hour prices, confirmed by above-baseline volume. The 24-hour market score adds context but does not delay the alert until a large move is already complete. Separate volume-spike alerts use a 2.5× recent baseline; directional alerts include 1-hour and 4-hour outcome checkpoints.</p>
      </PageHero>
      {signals.length > 0 && <p className="sr-only">Recent signals are listed below.</p>}
      <SignalFeed initialSignals={signals} query={apiQuery} databaseConfigured={dbOk} />
      <p className="text-xs text-muted">Signals are informational and never investment advice.</p>
    </div>
  );
}
