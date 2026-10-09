"use client";

import Link from "next/link";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { IChartApi, ISeriesApi, ISeriesMarkersPluginApi, MouseEventParams, SeriesMarker, Time, UTCTimestamp } from "lightweight-charts";
import type { HistoricalPoint, Timeframe } from "@/lib/market/types";
import { buildSignalMarker, findSignalCandle, normalizeUnixSeconds, signalRecordToChartSignal, type ChartSignal, type ChartSignalDetails, type Candle } from "@/lib/market/chart-signals";
import type { SignalView } from "@/lib/data/intel-queries";

const WINDOWS: { value: Timeframe; label: string }[] = [
  { value: "24h", label: "24H" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "90d", label: "90D" },
];

type Quote = { t: string; price: number; stale: boolean };
type HistoryResponse = { points?: HistoricalPoint[]; stale?: boolean; error?: string | null; checkedAt?: string; quote?: Quote | null };
export type PriceHistoryChartHandle = { addChartSignal: (signal: ChartSignal) => void };

type ChartSignalRecord = Pick<SignalView, "id" | "type" | "score" | "timestamp" | "evidence" | "outcome">;

function getChartTheme() {
  const styles = getComputedStyle(document.documentElement);
  return {
    background: styles.getPropertyValue("--chart-background").trim(),
    text: styles.getPropertyValue("--chart-text").trim(),
    grid: styles.getPropertyValue("--chart-grid").trim(),
    border: styles.getPropertyValue("--chart-border").trim(),
    crosshair: styles.getPropertyValue("--chart-crosshair").trim(),
    line: styles.getPropertyValue("--color-phosphor").trim(),
  };
}

function mergeQuote(points: HistoricalPoint[], previous: HistoricalPoint[], quote?: Quote | null) {
  const endOfHistory = points.length ? Date.parse(points[points.length - 1].t) : 0;
  const retained = previous.filter((point) => Date.parse(point.t) > endOfHistory);
  const fresh = quote && Number.isFinite(quote.price) && quote.price > 0 && Date.parse(quote.t) > endOfHistory
    ? [{ t: quote.t, price: quote.price, volume: null }]
    : [];
  const unique = new Map<string, HistoricalPoint>();
  for (const point of [...points, ...retained, ...fresh]) unique.set(point.t, point);
  return [...unique.values()].sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
}

function formatPrice(value: number) {
  return value >= 1
    ? `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`
    : `$${value.toLocaleString("en-US", { maximumFractionDigits: 8 })}`;
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function outcomeLabel(signal: ChartSignalDetails, horizon: "oneHour" | "fourHour", horizonMinutes: number) {
  const stage = signal.outcome?.[horizon];
  if (stage) return stage.status.charAt(0).toUpperCase() + stage.status.slice(1).replace("_", " ");
  const timestamp = normalizeUnixSeconds(signal.timestamp);
  const ageMinutes = timestamp === null ? 0 : (Date.now() / 1000 - timestamp) / 60;
  return ageMinutes >= horizonMinutes ? "Not evaluated" : "Pending";
}

function mergeSignals(previous: ChartSignalDetails[], incoming: ChartSignalDetails[]) {
  const byId = new Map(previous.map((signal) => [signal.id, signal]));
  for (const signal of incoming) byId.set(signal.id, { ...byId.get(signal.id), ...signal });
  return [...byId.values()]
    .sort((a, b) => (normalizeUnixSeconds(b.timestamp) ?? 0) - (normalizeUnixSeconds(a.timestamp) ?? 0))
    .slice(0, 200);
}

function signalTimeLabel(signal: ChartSignal) {
  const seconds = normalizeUnixSeconds(signal.timestamp);
  return seconds === null ? "Unknown time" : `${formatTime(new Date(seconds * 1000).toISOString())} UTC`;
}

type Props = {
  symbol: string;
  initialPoints: HistoricalPoint[];
  initialStale?: boolean;
  initialQuote?: { t: string; price: number };
  initialSignals?: SignalView[];
};

export const PriceHistoryChart = forwardRef<PriceHistoryChartHandle, Props>(function PriceHistoryChart({
  symbol,
  initialPoints,
  initialStale = false,
  initialQuote,
  initialSignals = [],
}: Props, ref) {
  const [timeframe, setTimeframe] = useState<Timeframe>("24h");
  const [points, setPoints] = useState(() => mergeQuote(initialPoints, [], initialQuote ? { ...initialQuote, stale: false } : null));
  const [loadedTimeframe, setLoadedTimeframe] = useState<Timeframe>("24h");
  const loadedTimeframeRef = useRef<Timeframe>("24h");
  const [stale, setStale] = useState(initialStale);
  const [quote, setQuote] = useState<Quote | null>(initialQuote ? { ...initialQuote, stale: false } : null);
  const [chartSignals, setChartSignals] = useState<ChartSignalDetails[]>(() =>
    initialSignals.map(signalRecordToChartSignal).filter((signal): signal is ChartSignalDetails => signal !== null)
  );
  const [selectedSignalId, setSelectedSignalId] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [chartReady, setChartReady] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const priceSeriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const chartSignalsRef = useRef(chartSignals);
  chartSignalsRef.current = chartSignals;
  const fittedRangeRef = useRef<string | null>(null);
  const firstEffect = useRef(true);

  const addChartSignal = useCallback((signal: ChartSignal) => {
    const timestamp = normalizeUnixSeconds(signal.timestamp);
    if (timestamp === null || !signal.id) return;
    const normalized: ChartSignalDetails = { ...signal, timestamp };
    setChartSignals((previous) => mergeSignals(previous, [normalized]));
  }, []);
  useImperativeHandle(ref, () => ({ addChartSignal }), [addChartSignal]);

  useEffect(() => {
    let active = true;
    let chart: IChartApi | null = null;
    let themeObserver: MutationObserver | null = null;
    let handleChartClick: ((event: MouseEventParams<Time>) => void) | null = null;
    void import("lightweight-charts").then(({ AreaSeries, ColorType, createChart, createSeriesMarkers }) => {
      const container = containerRef.current;
      if (!active || !container) return;
      const theme = getChartTheme();
      chart = createChart(container, {
        autoSize: true,
        layout: {
          background: { type: ColorType.Solid, color: theme.background },
          textColor: theme.text,
          fontFamily: "IBM Plex Sans, sans-serif",
          attributionLogo: true,
        },
        grid: {
          vertLines: { color: theme.grid },
          horzLines: { color: theme.grid },
        },
        rightPriceScale: { borderColor: theme.border },
        timeScale: { borderColor: theme.border, timeVisible: true, secondsVisible: false },
        crosshair: { vertLine: { color: theme.crosshair }, horzLine: { color: theme.crosshair } },
      });
      themeObserver = new MutationObserver(() => {
        if (!chart) return;
        const updatedTheme = getChartTheme();
        chart.applyOptions({
          layout: {
            background: { type: ColorType.Solid, color: updatedTheme.background },
            textColor: updatedTheme.text,
          },
          grid: { vertLines: { color: updatedTheme.grid }, horzLines: { color: updatedTheme.grid } },
          rightPriceScale: { borderColor: updatedTheme.border },
          timeScale: { borderColor: updatedTheme.border },
          crosshair: { vertLine: { color: updatedTheme.crosshair }, horzLine: { color: updatedTheme.crosshair } },
        });
        priceSeriesRef.current?.applyOptions({ lineColor: updatedTheme.line });
      });
      themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
      handleChartClick = (event: MouseEventParams<Time>) => {
        const objectId = event.hoveredInfo?.objectId;
        if (event.hoveredInfo?.objectKind === "series-marker" && typeof objectId === "string" && chartSignalsRef.current.some((signal) => signal.id === objectId)) {
          setSelectedSignalId(objectId);
        }
      };
      chart.subscribeClick(handleChartClick);
      const priceSeries = chart.addSeries(AreaSeries, {
        lineColor: theme.line,
        topColor: "rgba(74,222,128,0.24)",
        bottomColor: "rgba(74,222,128,0.015)",
        lineWidth: 2,
        priceLineVisible: true,
        lastValueVisible: true,
      });
      priceSeriesRef.current = priceSeries;
      markersRef.current = createSeriesMarkers(priceSeries, [], { autoScale: true });
      chartRef.current = chart;
      setChartReady(true);
    }).catch((err: unknown) => {
      if (active) setError(err instanceof Error ? err.message : "Could not load the chart");
    });

    return () => {
      active = false;
      themeObserver?.disconnect();
      if (chart && handleChartClick) chart.unsubscribeClick(handleChartClick);
      chart?.remove();
      if (chartRef.current === chart) chartRef.current = null;
      priceSeriesRef.current = null;
      markersRef.current = null;
    };
  }, []);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setInterval>;
    const controller = new AbortController();

    async function refresh() {
      if (document.visibilityState !== "visible") return;
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/market/assets/${encodeURIComponent(symbol)}/history?timeframe=${timeframe}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const body = (await response.json()) as HistoryResponse;
        if (!response.ok) throw new Error(body.error ?? `Chart request failed (${response.status})`);
        if (active && Array.isArray(body.points)) {
          setPoints((previous) => mergeQuote(body.points!, loadedTimeframeRef.current === timeframe ? previous : [], body.quote));
          loadedTimeframeRef.current = timeframe;
          setLoadedTimeframe(timeframe);
          setQuote(body.quote ?? null);
          setStale(Boolean(body.stale));
          setCheckedAt(body.checkedAt ?? new Date().toISOString());
          setError(body.error ?? null);
        }
      } catch (err) {
        if (active && !(err instanceof Error && err.name === "AbortError")) {
          setError(err instanceof Error ? err.message : "Could not refresh chart data");
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    if (firstEffect.current && timeframe === "24h" && initialPoints.length > 1) {
      firstEffect.current = false;
    } else {
      firstEffect.current = false;
      void refresh();
    }
    timer = setInterval(() => void refresh(), 60_000);
    return () => {
      active = false;
      controller.abort();
      clearInterval(timer);
    };
  }, [symbol, timeframe, initialPoints.length]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    async function refreshSignals() {
      if (document.visibilityState !== "visible") return;
      try {
        const query = new URLSearchParams({ symbol, limit: "100" });
        const response = await fetch(`/api/signals?${query}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const body = (await response.json()) as { signals?: ChartSignalRecord[] };
        if (active && Array.isArray(body.signals)) {
          const incoming = body.signals.map(signalRecordToChartSignal).filter((signal): signal is ChartSignalDetails => signal !== null);
          setChartSignals((previous) => mergeSignals(previous, incoming));
        }
      } catch (err) {
        if (!(err instanceof Error && err.name === "AbortError")) return;
      }
    }
    void refreshSignals();
    const timer = setInterval(() => void refreshSignals(), 60_000);
    return () => {
      active = false;
      controller.abort();
      clearInterval(timer);
    };
  }, [symbol]);

  const values = useMemo(() => (loadedTimeframe === timeframe ? points : [])
    .filter((point) => Number.isFinite(point.price) && point.price > 0), [loadedTimeframe, points, timeframe]);
  const chartData = useMemo(() => values.flatMap((point) => {
    const time = Math.floor(Date.parse(point.t) / 1000);
    return Number.isFinite(time) ? [{ time: time as UTCTimestamp, value: point.price }] : [];
  }).sort((a, b) => a.time - b.time), [values]);
  const candles = useMemo<Candle[]>(() => chartData.map((point) => ({ time: point.time, price: point.value })), [chartData]);
  const first = values[0]?.price;
  const last = quote?.price ?? values[values.length - 1]?.price;
  const change = first && last ? ((last - first) / first) * 100 : null;
  const rising = change !== null && change >= 0;
  const visibleSignals = useMemo(() => chartSignals
    .filter((signal) => findSignalCandle(signal.timestamp, candles) !== null)
    .sort((a, b) => (normalizeUnixSeconds(b.timestamp) ?? 0) - (normalizeUnixSeconds(a.timestamp) ?? 0)), [chartSignals, candles]);

  const selectedSignal = selectedSignalId ? chartSignals.find((signal) => signal.id === selectedSignalId) ?? null : null;

  useEffect(() => {
    const priceSeries = priceSeriesRef.current;
    if (!chartReady || !priceSeries) return;
    priceSeries.applyOptions({
      lineColor: rising ? "#4ade80" : "#fb7185",
      topColor: rising ? "rgba(74,222,128,0.24)" : "rgba(251,113,133,0.22)",
      bottomColor: rising ? "rgba(74,222,128,0.015)" : "rgba(251,113,133,0.015)",
    });
    priceSeries.setData(chartData);

    const markers = visibleSignals
      .map((signal) => buildSignalMarker(signal, candles))
      .filter((marker): marker is SeriesMarker<UTCTimestamp> => marker !== null);
    markersRef.current?.setMarkers(markers);

    const rangeKey = `${timeframe}:${chartData[0]?.time ?? "empty"}:${chartData[chartData.length - 1]?.time ?? "empty"}`;
    if (chartData.length > 1 && fittedRangeRef.current !== rangeKey) {
      chartRef.current?.timeScale().fitContent();
      fittedRangeRef.current = rangeKey;
    }
  }, [candles, chartData, chartReady, rising, timeframe, visibleSignals]);

  const high = values.length ? Math.max(...values.map((point) => point.price)) : null;
  const low = values.length ? Math.min(...values.map((point) => point.price)) : null;

  return (
    <section className="story-glass p-4 sm:p-6" aria-labelledby="price-chart-title">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="price-chart-title" className="m-0 font-mono text-lg font-semibold">TradingView chart</h2>
          {last != null && (
            <div className="mt-1 flex flex-wrap items-baseline gap-x-3">
              <span className="font-mono text-2xl">{formatPrice(last)}</span>
              {change !== null && <span className={`font-mono text-sm ${rising ? "text-emerald-400" : "text-rose-400"}`}>{rising ? "+" : ""}{change.toFixed(2)}%</span>}
            </div>
          )}
        </div>
        <div className="flex gap-1 rounded-xl border border-white/10 bg-black/30 p-1" aria-label="Chart timeframe">
          {WINDOWS.map((window) => (
            <button
              key={window.value}
              type="button"
              aria-pressed={timeframe === window.value}
              onClick={() => setTimeframe(window.value)}
              className={`rounded-lg px-3 py-1.5 font-mono text-xs transition-colors ${timeframe === window.value ? "bg-white/10 text-ink" : "text-muted hover:text-ink"}`}
            >
              {window.label}
            </button>
          ))}
        </div>
      </div>

      <div className="relative">
        <div ref={containerRef} className={`h-64 w-full overflow-hidden rounded-xl sm:h-80 ${values.length > 1 ? "" : "invisible"}`} role="img" aria-label={`${symbol} TradingView price chart for ${timeframe}`} />
        {values.length <= 1 && (
          <div className="absolute inset-0 grid place-items-center rounded-xl border border-white/5 bg-black/20 px-5 text-center text-sm text-muted">
            {!chartReady || loading ? "Loading price history…" : `Price history for ${symbol} is unavailable right now.`}
          </div>
        )}
      </div>
      {values.length > 1 ? (
        <>
          <div className="mt-1 flex justify-between font-mono text-[10px] text-muted">
            <span>{formatTime(values[0].t)} UTC</span><span>{formatTime(values[values.length - 1].t)} UTC</span>
          </div>
          <div className="mt-3 flex flex-wrap justify-between gap-2 text-[11px] text-muted">
            <span>{high !== null && low !== null ? `Range ${formatPrice(low)} – ${formatPrice(high)}` : ""}</span>
            <span>{visibleSignals.length} bullish/bearish flag{visibleSignals.length === 1 ? "" : "s"} in this chart window</span>
          </div>
          {visibleSignals.length > 0 ? (
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {visibleSignals.slice(0, 6).map((signal) => (
                <li key={signal.id}>
                  <Link href={`/signals/${signal.id}`} className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs no-underline ${signal.type === "BULLISH" ? "border-emerald-400/20 bg-emerald-400/5 hover:border-emerald-300/50" : "border-rose-400/20 bg-rose-400/5 hover:border-rose-300/50"}`}>
                    <span className={`font-mono ${signal.type === "BULLISH" ? "text-emerald-200" : "text-rose-200"}`}>{signal.type === "BULLISH" ? "▲" : "▼"} {signal.type} · {signal.metadata?.strength ?? "—"}/100</span>
                    <span className="text-muted">{signalTimeLabel(signal)}</span>
                    <span className="w-full font-mono text-[10px] text-muted">1h {outcomeLabel(signal, "oneHour", 60)} · 4h {outcomeLabel(signal, "fourHour", 240)} · view evidence</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-xs text-muted">No bullish or bearish signal timestamps fall inside this chart window. <Link href={`/signals?symbol=${encodeURIComponent(symbol)}`} className="text-phosphor">See all {symbol} signals</Link>.</p>
          )}
        </>
      ) : null}

      {selectedSignal ? (
        <section className={`mt-3 rounded-xl border p-4 ${selectedSignal.type === "BULLISH" ? "border-emerald-400/25 bg-emerald-400/5" : "border-rose-400/25 bg-rose-400/5"}`} aria-live="polite" aria-label="Signal details">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className={`m-0 font-mono text-sm font-semibold ${selectedSignal.type === "BULLISH" ? "text-emerald-200" : "text-rose-200"}`}>{selectedSignal.title ?? `${selectedSignal.type} signal`}</h3>
              <p className="mb-0 mt-1 text-xs text-muted">{signalTimeLabel(selectedSignal)}</p>
            </div>
            <button type="button" className="btn btn-ghost shrink-0" onClick={() => setSelectedSignalId(null)} aria-label="Close signal details">Close</button>
          </div>
          {selectedSignal.description && <p className="mb-0 mt-3 text-sm text-muted">{selectedSignal.description}</p>}
          <dl className="mb-0 mt-3 grid gap-x-5 gap-y-1 text-xs sm:grid-cols-2">
            {selectedSignal.price !== undefined && <><dt className="text-muted">Signal price</dt><dd className="m-0 font-mono">{formatPrice(selectedSignal.price)}</dd></>}
            {selectedSignal.metadata?.strength !== undefined && <><dt className="text-muted">Strength</dt><dd className="m-0 font-mono">{selectedSignal.metadata.strength}/100</dd></>}
            {selectedSignal.metadata?.confidence !== undefined && <><dt className="text-muted">Confidence</dt><dd className="m-0 font-mono">{selectedSignal.metadata.confidence}/100</dd></>}
            {selectedSignal.metadata?.source && <><dt className="text-muted">Source</dt><dd className="m-0">{selectedSignal.metadata.source}</dd></>}
          </dl>
        </section>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-muted" role="status" aria-live="polite">
        <span>{error ? `Refresh issue: ${error}` : stale || quote?.stale ? "Showing cached provider data" : "Market quote · refreshes every minute"}</span>
        {checkedAt && <span>{loading ? "Refreshing…" : `Checked ${checkedAt.slice(11, 16)} UTC`}</span>}
      </div>
      <p className="mb-0 mt-2 text-[11px] text-dim">Chart rendered with TradingView Lightweight Charts™. Quotes refresh once a minute; historical samples follow the provider&apos;s update interval and are not exchange-tick streaming.</p>
    </section>
  );
});
