import type { SignalView, SignalOutcomeStage } from "@/lib/data/intel-queries";
import { THRESHOLDS } from "@/lib/signals/engine";
import { WEIGHTS } from "@/lib/score/engine";
import { formatUsd } from "@/lib/intel/format";

const FACTORS = [
  { key: "momentum", label: "Price momentum", description: "24-hour price movement", weight: WEIGHTS.momentum },
  { key: "volume", label: "Volume activity", description: "24-hour volume versus its recent baseline", weight: WEIGHTS.volume },
  { key: "liquidity", label: "Turnover", description: "24-hour volume relative to market cap", weight: WEIGHTS.liquidity },
  { key: "volatility", label: "Volatility", description: "How steady recent price moves have been", weight: WEIGHTS.volatility },
  { key: "marketCap", label: "Market size", description: "Market-cap context in the tracked universe", weight: WEIGHTS.marketCap },
  { key: "movingAverage", label: "Price trend", description: "Latest price relative to its recent average", weight: WEIGHTS.movingAverage },
  { key: "newsSocial", label: "News activity", description: "Recent news coverage (social data may be unavailable)", weight: WEIGHTS.newsSocial },
] as const;

function DirectionalExplanation({ signal, defaultOpen }: { signal: SignalView; defaultOpen: boolean }) {
  const bullish = signal.type === "bullish";
  const evidence = signal.evidence ?? {};
  const components = evidence.components && typeof evidence.components === "object" && !Array.isArray(evidence.components)
    ? evidence.components as Record<string, unknown>
    : {};
  const factorRows = FACTORS.flatMap((factor) => {
    const score = components[factor.key];
    if (typeof score !== "number" || !Number.isFinite(score)) return [];
    const impact = Math.round(((bullish ? score : score - 100) / 100) * factor.weight * 100) / 100;
    return [{ ...factor, score, impact }];
  }).sort((a, b) => bullish ? b.impact - a.impact : a.impact - b.impact);
  const volumeRatio = typeof evidence.volumeRatio === "number" ? evidence.volumeRatio : null;
  const newsCount = typeof evidence.newsCount24h === "number" ? evidence.newsCount24h : null;
  const earlyTrigger = evidence.triggerModel === "momentum_acceleration_v1";
  const change15m = typeof evidence.priceChange15m === "number" ? evidence.priceChange15m : null;
  const change1h = typeof evidence.priceChange1h === "number" ? evidence.priceChange1h : null;

  return (
    <details open={defaultOpen} className="mt-3 border-t border-line pt-3">
      <summary className={`cursor-pointer text-sm font-semibold ${bullish ? "text-emerald-300 hover:text-emerald-200" : "text-rose-300 hover:text-rose-200"}`}>Why was this {bullish ? "bullish" : "bearish"}?</summary>
      <div className="mt-3 space-y-4">
        <p className="m-0 text-sm text-muted">
          {earlyTrigger
            ? `This ${bullish ? "bullish" : "bearish"} alert triggered on an accelerating ${bullish ? "upward" : "downward"} move across the 15-minute and 1-hour windows, with volume confirmation. The overall 24-hour score is context; it does not trigger this alert.`
            : bullish
              ? `This older signal used the ${THRESHOLDS.bullishScore}/100 score threshold.`
              : `This older signal used the ${THRESHOLDS.bearishScore}/100 score threshold.`} The event's overall score was <b className={bullish ? "text-emerald-300" : "text-rose-300"}>{signal.score}/100</b>; it is a rule-based reading, not a prediction.
        </p>
        {factorRows.length ? (
          <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2">
            {factorRows.map((factor) => (
              <li key={factor.key} className="rounded-lg border border-white/10 bg-black/20 p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <b className="text-sm">{factor.label}</b>
                  <span className={`font-mono text-xs ${bullish ? "text-emerald-300" : "text-rose-300"}`}>{factor.impact >= 0 ? "+" : "−"}{Math.abs(factor.impact).toFixed(2)} / {factor.weight} pts</span>
                </div>
                <p className="m-0 mt-1 text-xs text-muted">{factor.description} · factor score {factor.score}/100 · {bullish ? "points added" : "points below maximum"}</p>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10" aria-label={`${factor.label} factor score ${factor.score} out of 100`} role="img">
                  <div className={`h-full rounded-full ${bullish ? "bg-emerald-400" : "bg-rose-400"}`} style={{ width: `${Math.max(0, Math.min(100, factor.score))}%` }} />
                </div>
              </li>
            ))}
          </ul>
        ) : <p className="m-0 text-sm text-muted">Factor scores were not saved for this event. The snapshot evidence below is still available.</p>}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-line pt-3 text-xs">
          <div><dt className="text-muted">24h price move</dt><dd className="m-0 font-mono">{typeof evidence.priceChange24h === "number" ? `${evidence.priceChange24h >= 0 ? "+" : ""}${evidence.priceChange24h.toFixed(2)}%` : "—"}</dd></div>
          {earlyTrigger && <>
            <div><dt className="text-muted">15m price move</dt><dd className="m-0 font-mono">{change15m === null ? "Not recorded" : `${change15m >= 0 ? "+" : ""}${change15m.toFixed(2)}%`}{typeof evidence.triggerThreshold15mPct === "number" && ` · trigger ${bullish ? "+" : "−"}${evidence.triggerThreshold15mPct}%`}</dd></div>
            <div><dt className="text-muted">1h price move</dt><dd className="m-0 font-mono">{change1h === null ? "Not recorded" : `${change1h >= 0 ? "+" : ""}${change1h.toFixed(2)}%`}{typeof evidence.triggerThreshold1hPct === "number" && ` · trigger ${bullish ? "+" : "−"}${evidence.triggerThreshold1hPct}%`}</dd></div>
            <div><dt className="text-muted">Volume confirmation</dt><dd className="m-0 font-mono">{volumeRatio === null ? "Not recorded" : `${volumeRatio.toFixed(2)}× baseline`}{typeof evidence.triggerMinVolumeRatio === "number" && ` · minimum ${evidence.triggerMinVolumeRatio.toFixed(2)}×`}</dd></div>
          </>}
          <div><dt className="text-muted">24h volume</dt><dd className="m-0 font-mono">{formatUsd(evidence.volume24h)}</dd></div>
          <div><dt className="text-muted">Volume vs baseline</dt><dd className="m-0 font-mono">{volumeRatio === null ? "Not recorded" : `${volumeRatio.toFixed(2)}×`}</dd></div>
          <div><dt className="text-muted">Market cap</dt><dd className="m-0 font-mono">{formatUsd(evidence.marketCap)}</dd></div>
          <div><dt className="text-muted">News in 24h</dt><dd className="m-0 font-mono">{newsCount === null ? "Not recorded" : newsCount}</dd></div>
          <div><dt className="text-muted">Scoring formula</dt><dd className="m-0 font-mono">{signal.formulaVersion}</dd></div>
        </dl>
      </div>
    </details>
  );
}

function DirectionalOutcome({ signal, defaultOpen }: { signal: SignalView; defaultOpen: boolean }) {
  const bullish = signal.type === "bullish";
  const signalAt = new Date(signal.timestamp);
  const oneHour = signal.outcome?.oneHour;
  const fourHour = signal.outcome?.fourHour;

  function stageStatus(stage: SignalOutcomeStage | undefined, horizonMinutes: number) {
    if (stage) return stage.status;
    const ageMinutes = (Date.now() - signalAt.getTime()) / 60_000;
    return ageMinutes >= horizonMinutes ? "not_evaluated" : "pending";
  }

  function formatPct(value: number | null) {
    if (value === null || !Number.isFinite(value)) return "—";
    return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
  }

  function renderStage(stage: SignalOutcomeStage | undefined, label: string, horizonMinutes: number) {
    const status = stageStatus(stage, horizonMinutes);
    const colors: Record<string, string> = {
      success: "text-emerald-300", failed: "text-red-300", mixed: "text-amber-300", not_evaluated: "text-zinc-400",
    };
    return (
      <div key={label} className="rounded-lg border border-white/10 bg-black/20 p-3">
        <div className="flex items-baseline justify-between gap-2">
          <b className="text-sm">{label}</b>
          <span className={`font-mono text-xs ${colors[status] ?? "text-muted"}`}>{status.charAt(0).toUpperCase() + status.slice(1).replace("_", " ")}</span>
        </div>
        {stage ? (
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <div><dt className="text-muted">Tier</dt><dd className="m-0 font-mono">{stage.tier.replace("_", " ")}</dd></div>
            <div><dt className="text-muted">Favorable boundary</dt><dd className="m-0 font-mono">{bullish ? "+" : "−"}{stage.targetPct.toFixed(1)}%</dd></div>
            <div><dt className="text-muted">Tier minimum</dt><dd className="m-0 font-mono">{stage.tierMinimumPct}%</dd></div>
            <div><dt className="text-muted">Volatility adj.</dt><dd className="m-0 font-mono">{stage.volatilityAdjustmentPct.toFixed(1)}%</dd></div>
            <div><dt className="text-muted">Return</dt><dd className="m-0 font-mono">{formatPct(stage.returnPct)}</dd></div>
            <div><dt className="text-muted">Max favorable</dt><dd className="m-0 font-mono">{formatPct(stage.maxFavorableMovePct)}</dd></div>
            <div><dt className="text-muted">Max adverse</dt><dd className="m-0 font-mono">{formatPct(stage.maxAdverseMovePct)}</dd></div>
            <div><dt className="text-muted">Rolling vol. change</dt><dd className="m-0 font-mono">{formatPct(stage.rollingVolumeChangePct)}</dd></div>
            <div><dt className="text-muted">BTC return</dt><dd className="m-0 font-mono">{formatPct(stage.btcReturnPct)}</dd></div>
            <div className="col-span-2"><dt className="text-muted">Coverage</dt><dd className="m-0 font-mono">{stage.sampleCount} samples · {stage.coverageMinutes.toFixed(1)} min</dd></div>
            <div className="col-span-2"><dt className="text-muted">Why this result</dt><dd className="m-0">{stage.reason ?? "No explanation was stored."}</dd></div>
            {stage.evaluatedAt && <div className="col-span-2"><dt className="text-muted">Evaluated</dt><dd className="m-0 font-mono">{new Date(stage.evaluatedAt).toLocaleString()}</dd></div>}
          </dl>
        ) : (
          <p className="m-0 mt-2 text-xs text-muted">
            {status === "pending" ? "The checkpoint window is still in progress." : "The checkpoint window passed, but no outcome was stored."}
          </p>
        )}
      </div>
    );
  }

  return (
    <details open={defaultOpen} className="mt-3 border-t border-line pt-3">
      <summary className={`cursor-pointer text-sm font-semibold ${bullish ? "text-emerald-300 hover:text-emerald-200" : "text-rose-300 hover:text-rose-200"}`}>Outcome checkpoints · {bullish ? "upside" : "downside"} target</summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {renderStage(oneHour, "1-hour checkpoint", 60)}
        {renderStage(fourHour, "4-hour checkpoint", 240)}
      </div>
    </details>
  );
}

export function SignalAnalysis({ signal, defaultOpen = false }: { signal: SignalView; defaultOpen?: boolean }) {
  if (signal.type !== "bullish" && signal.type !== "bearish") return null;
  return (
    <div>
      <DirectionalExplanation signal={signal} defaultOpen={defaultOpen} />
      <DirectionalOutcome signal={signal} defaultOpen={defaultOpen} />
    </div>
  );
}
