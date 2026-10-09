"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { SignalView } from "@/lib/data/intel-queries";
import { SignalAnalysis } from "@/components/SignalAnalysis";

export function SignalFeed({ initialSignals, query = "", databaseConfigured = true }: { initialSignals: SignalView[]; query?: string; databaseConfigured?: boolean }) {
  const [signals, setSignals] = useState(initialSignals);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;

    async function load() {
      if (document.visibilityState !== "visible") {
        timer = setTimeout(load, 30_000);
        return;
      }
      try {
        const suffix = query ? `?${query}` : "";
        const response = await fetch(`/api/signals${suffix}`, { cache: "no-store" });
        if (!response.ok) throw new Error(`Request failed (${response.status})`);
        const result = (await response.json()) as { signals?: SignalView[] };
        if (!Array.isArray(result.signals)) throw new Error("Unexpected response from signals API");
        if (active) {
          setSignals(result.signals);
          setCheckedAt(new Date());
          setError(null);
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Could not refresh signals");
      } finally {
        if (active) timer = setTimeout(load, 30_000);
      }
    }
    void load();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);

  const refreshed = checkedAt ? `Checked ${checkedAt.toLocaleTimeString()}` : "Checking for updates…";

  return (
    <div>
      <p className="text-xs text-muted" role="status" aria-live="polite">
        {error ? `Update failed: ${error} · retrying in 30 seconds` : `${refreshed} · auto-refreshes every 30 seconds`}
      </p>
      {signals.length === 0 ? (
        <div className="panel p-6 text-center text-muted">{databaseConfigured ? "No signals at this time." : "Signal data is unavailable until a database is configured."}</div>
      ) : (
        <ul className="space-y-2">
          {signals.map((signal) => (
            <li key={signal.id}>
              <article className="panel list-card-motion p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Link href={`/signals/${signal.id}`} className="font-mono text-sm font-semibold text-ink no-underline hover:text-phosphor">
                      {signal.symbol} · {signal.type.replace(/_/g, " ")} · {signal.score}/100
                    </Link>
                    <Link href={`/market/${signal.symbol}`} className="text-xs text-muted hover:text-phosphor">Open market page</Link>
                  </div>
                  <time className="text-xs text-muted" dateTime={signal.timestamp}>{new Date(signal.timestamp).toLocaleString()}</time>
                </div>
                <SignalAnalysis signal={signal} />
              </article>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
