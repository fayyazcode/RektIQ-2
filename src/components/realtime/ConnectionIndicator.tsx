"use client";

import { useRealtimeOptional } from "./RealtimeProvider";

export function ConnectionIndicator() {
  const rt = useRealtimeOptional();
  if (!rt) return null;
  if (!process.env.NEXT_PUBLIC_REALTIME_URL && rt.error) return null;

  const dot =
    rt.status === "connected" ? "bg-emerald-500" : rt.status === "connecting" ? "bg-amber-500 animate-pulse" : "bg-zinc-500";
  const label = rt.status === "connected" ? (rt.stale ? "Live · stale" : "Live") : rt.status === "connecting" ? "Connecting…" : "Offline";
  const last = rt.lastUpdated ? new Date(rt.lastUpdated).toLocaleTimeString() : null;

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-zinc-400" aria-live="polite" title={rt.error ?? undefined}>
      <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden />
      {label}
      {last ? <span className="opacity-70">· {last}</span> : null}
      {rt.stale && rt.status === "connected" ? <span className="rounded bg-amber-500/20 px-1 py-0.5 text-[10px] text-amber-300">stale</span> : null}
    </span>
  );
}
