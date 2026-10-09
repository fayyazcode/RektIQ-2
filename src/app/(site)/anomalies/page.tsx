import { listAnomalies, type AnomalyView } from "@/lib/data/intel-queries";
import { hasDatabase } from "@/lib/db";
import { fmtPct, fmtUsd } from "@/lib/format";
import Link from "next/link";
import PageHero from "@/components/PageHero";
import Time from "@/components/Time";

export const dynamic = "force-dynamic";

const anomalyInfo: Record<string, { title: string; explanation: string }> = {
  unusual_volume: {
    title: "Unusual trading volume",
    explanation: "The asset's 24-hour dollar trading volume is far above its recent average. This can mean more trading activity than usual, but it does not show whether buyers or sellers are in control.",
  },
  rapid_price_move: {
    title: "Rapid 24-hour price move",
    explanation: "The price rose or fell by at least 8% in 24 hours. The detector compares this move with a fixed threshold, not a historical price average.",
  },
  abnormal_volatility: {
    title: "Elevated short-term volatility",
    explanation: "Recent price swings are larger than the asset's typical short-term swings. Volatility measures the size of moves, not their direction.",
  },
  liquidity_change: {
    title: "Turnover changed",
    explanation: "The volume-to-market-cap ratio is unusually high or low compared with its recent average. It is a turnover proxy, not a direct measure of order-book depth.",
  },
  marketcap_change: {
    title: "Market capitalization changed",
    explanation: "The current market capitalization differs noticeably from its recent average. This value can change with price, circulating supply data, or provider updates.",
  },
  news_surge: {
    title: "News coverage increased",
    explanation: "The number of tagged articles about this asset is much higher than its usual daily news flow. More coverage does not imply positive news or a price move.",
  },
  social_surge: {
    title: "Social activity increased",
    explanation: "The available social activity score is higher than its recent baseline. This depends on the configured social data source and does not measure sentiment by itself.",
  },
};

function number(value: number) {
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function getEvidence(anomaly: AnomalyView) {
  switch (anomaly.type) {
    case "unusual_volume":
      return {
        observed: { label: "24h volume", value: fmtUsd(anomaly.observed) },
        reference: { label: "Recent average", value: fmtUsd(anomaly.baseline) },
        comparison: `${anomaly.ratio.toFixed(2)}× the recent average`,
      };
    case "rapid_price_move":
      return {
        observed: { label: "24h price change", value: fmtPct(anomaly.observed) },
        reference: { label: "Trigger threshold", value: "±8% in 24h" },
        comparison: `${anomaly.ratio.toFixed(2)}× the trigger level`,
      };
    case "abnormal_volatility":
      return {
        observed: { label: "Recent volatility", value: fmtPct(anomaly.observed * 100) },
        reference: { label: "Typical volatility", value: fmtPct(anomaly.baseline * 100) },
        comparison: `${anomaly.ratio.toFixed(2)}× its recent average`,
      };
    case "liquidity_change":
      return {
        observed: { label: "Current turnover", value: fmtPct(anomaly.observed * 100) },
        reference: { label: "Typical turnover", value: fmtPct(anomaly.baseline * 100) },
        comparison: `${anomaly.ratio.toFixed(2)}× its recent average`,
      };
    case "marketcap_change":
      return {
        observed: { label: "Current market cap", value: fmtUsd(anomaly.observed) },
        reference: { label: "Recent average", value: fmtUsd(anomaly.baseline) },
        comparison: `${fmtPct((anomaly.ratio - 1) * 100)} vs its recent average`,
      };
    case "news_surge":
      return {
        observed: { label: "Articles in 24h", value: number(anomaly.observed) },
        reference: { label: "Usual daily coverage", value: `about ${number(anomaly.baseline)} articles` },
        comparison: `${anomaly.ratio.toFixed(2)}× its usual daily coverage`,
      };
    case "social_surge":
      return {
        observed: { label: "Current activity score", value: number(anomaly.observed) },
        reference: { label: "Recent baseline score", value: number(anomaly.baseline) },
        comparison: `${anomaly.ratio.toFixed(2)}× its recent baseline`,
      };
    default:
      return {
        observed: { label: "Measured value", value: number(anomaly.observed) },
        reference: { label: "Reference value", value: number(anomaly.baseline) },
        comparison: `${anomaly.ratio.toFixed(2)}× the reference`,
      };
  }
}

function historyPeriod(anomaly: AnomalyView) {
  if (anomaly.type === "rapid_price_move") return null;
  const hours = anomaly.baselineWindowHours;
  if (!hours || !Number.isFinite(hours)) return null;
  return `Reference history: ${hours} ${hours === 1 ? "hour" : "hours"}`;
}

export default async function AnomaliesPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const qp = await searchParams;
  const anomalies = await listAnomalies({ symbol: qp.symbol, type: qp.type, limit: qp.limit ? Number(qp.limit) : 30 });
  const dbOk = hasDatabase();

  return (
    <div className="space-y-6">
      <PageHero variant="anomalies" kicker={<><span aria-hidden="true">$ </span>scan baselines</>} title="Anomalies">
        <p className="text-sm md:text-base leading-relaxed">An anomaly is a market measurement outside a rule or its usual range. Each card explains what changed and shows the data behind the alert. Severity describes how strongly a rule was crossed; thresholds differ by alert type. It is not a forecast, confidence score, or trading recommendation.</p>
      </PageHero>
      {!dbOk && (
        <div className="panel p-4 border-amber-400/30 bg-amber-400/5">
          <p className="text-sm text-amber-300">
            Database not configured. Set <code className="font-mono">DATABASE_URL</code> to your Supabase PostgreSQL connection string and run <code className="font-mono">npm run job:realtime</code> to populate anomalies.
          </p>
        </div>
      )}
      {dbOk && anomalies.length === 0 && (
        <div className="panel p-6 text-center">
          <p className="text-sm text-muted mb-2">No anomalies detected yet.</p>
          <p className="text-xs text-zinc-500">The realtime worker must first save market history. Then run the anomaly processor (<code className="font-mono">npm run job:anomalies</code>) to generate baseline-required detections.</p>
        </div>
      )}
      {anomalies.length ? (
        <ul className="space-y-3">
          {anomalies.map((anomaly) => {
            const info = anomalyInfo[anomaly.type] ?? { title: anomaly.type.replaceAll("_", " "), explanation: "A market measurement moved outside its expected range." };
            const evidence = getEvidence(anomaly);
            const history = historyPeriod(anomaly);
            return (
              <li key={anomaly.id}>
                <Link href={`/market/${anomaly.symbol}`} className="panel list-card-motion block p-4 no-underline">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-mono text-xs text-muted">{anomaly.symbol}</p>
                      <h2 className="font-mono text-base font-semibold">{info.title}</h2>
                    </div>
                    <span className="chip text-xs">{anomaly.severity} severity</span>
                  </div>
                  <p className="mt-2 text-sm text-muted">{info.explanation}</p>
                  <p className="mt-2 text-sm">{anomaly.description}</p>
                  <dl className="mt-3 grid gap-3 rounded border border-line bg-black/30 p-3 sm:grid-cols-2">
                    <div>
                      <dt className="text-xs text-muted">{evidence.observed.label}</dt>
                      <dd className="font-mono text-sm">{evidence.observed.value}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted">{evidence.reference.label}</dt>
                      <dd className="font-mono text-sm">{evidence.reference.value}</dd>
                    </div>
                  </dl>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                    <span>{evidence.comparison}</span>
                    {history ? <span>{history}</span> : null}
                    <span>Detected <Time iso={anomaly.timestamp} /></span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
