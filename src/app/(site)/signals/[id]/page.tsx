import Link from "next/link";
import { notFound } from "next/navigation";
import PageHero from "@/components/PageHero";
import Time from "@/components/Time";
import { SignalAnalysis } from "@/components/SignalAnalysis";
import { getSignalById } from "@/lib/data/intel-queries";

export const dynamic = "force-dynamic";

function displayEvidence(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value) ?? String(value);
  return String(value);
}

export default async function SignalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const signal = await getSignalById(id);
  if (!signal) notFound();

  const title = `${signal.symbol} ${signal.type.replace(/_/g, " ")} signal`;
  const evidence = Object.entries(signal.evidence ?? {});

  return (
    <div className="space-y-6">
      <PageHero variant="signals" kicker={<><span aria-hidden="true">$ </span>signal record · {signal.formulaVersion}</>} title={title}>
        <p className="text-sm text-muted">Score <span className="font-mono text-emerald-300">{signal.score}/100</span> · Triggered <Time iso={signal.timestamp} /></p>
        <p className="mt-2 flex flex-wrap gap-4 text-sm">
          <Link href={`/market/${signal.symbol}`} className="text-phosphor">Open {signal.symbol} market page</Link>
          <Link href="/signals" className="text-muted hover:text-ink">Back to all signals</Link>
        </p>
      </PageHero>

      {signal.type === "bullish" || signal.type === "bearish" ? (
        <SignalAnalysis signal={signal} defaultOpen />
      ) : (
        <section className="panel p-4 sm:p-6">
          <h2 className="m-0 font-mono text-lg">Recorded evidence</h2>
          <p className="mt-2 text-sm text-muted">This is a {signal.type.replace(/_/g, " ")} market event. Its recorded evidence is shown below.</p>
          {evidence.length ? (
            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
              {evidence.map(([key, value]) => (
                <div key={key} className="min-w-0 rounded-lg border border-white/10 bg-black/20 p-3">
                  <dt className="text-xs text-muted">{key.replace(/([A-Z])/g, " $1").replace(/_/g, " ")}</dt>
                  <dd className="m-0 mt-1 break-words font-mono text-sm">{displayEvidence(value)}</dd>
                </div>
              ))}
            </dl>
          ) : <p className="mt-4 text-sm text-muted">No evidence fields were stored for this event.</p>}
        </section>
      )}

      <p className="text-xs text-muted">Market statistics are retrospective evidence, not a prediction or investment advice.</p>
    </div>
  );
}
