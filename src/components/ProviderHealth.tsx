"use client";

import { useEffect, useState } from "react";
import { useRealtimeOptional } from "@/components/realtime/RealtimeProvider";

type ProviderHealth = {
  provider: string;
  requests: number;
  errors: number;
  rateLimits: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
  avgLatencyMs: number;
  stale: boolean;
  updatedAt: string;
};

export function ProviderHealth() {
  const [health, setHealth] = useState<ProviderHealth[]>([]);
  const rt = useRealtimeOptional();

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/provider-health", { cache: "no-store" });
        if (res.ok) {
          const data = (await res.json()) as { health: ProviderHealth[] };
          setHealth(data.health);
        }
      } catch {
        /* offline */
      }
    }
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, []);

  if (!rt) return null;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-medium">Provider Health</h2>

      {health.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm sm:text-xs">
            <thead className="text-left text-muted font-mono text-xs">
              <tr>
                <th className="py-2 pr-3">Provider</th>
                <th className="py-2 pr-3">Requests</th>
                <th className="py-2 pr-3">Errors</th>
                <th className="py-2 pr-3">Rate Limits</th>
                <th className="py-2 pr-3">Avg Latency</th>
                <th className="py-2 pr-3">Last Success</th>
                <th className="py-2 pr-3">Last Failure</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {health.map((h) => (
                <tr key={h.provider} className="border-t border-line">
                  <td className="py-2 pr-3 font-mono">{h.provider}</td>
                  <td className="py-2 pr-3 font-mono">{h.requests}</td>
                  <td className={`py-2 pr-3 font-mono ${h.errors > 0 ? "text-red-400" : "text-zinc-400"}`}>
                    {h.errors}
                  </td>
                  <td className={`py-2 pr-3 font-mono ${h.rateLimits > 0 ? "text-amber-400" : "text-zinc-400"}`}>
                    {h.rateLimits}
                  </td>
                  <td className="py-2 pr-3 font-mono">{h.avgLatencyMs}ms</td>
                  <td className="py-2 pr-3 font-mono text-zinc-400">
                    {h.lastSuccessAt ? new Date(h.lastSuccessAt).toLocaleTimeString() : "—"}
                  </td>
                  <td className="py-2 pr-3 font-mono text-zinc-400">
                    {h.lastFailureAt ? new Date(h.lastFailureAt).toLocaleTimeString() : "—"}
                  </td>
                  <td className="py-2">
                    {h.stale ? (
                      <span className="text-xs bg-red-500/20 text-red-400 rounded px-2 py-0.5">stale</span>
                    ) : (
                      <span className="text-xs bg-emerald-500/20 text-emerald-400 rounded px-2 py-0.5">healthy</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-muted text-sm">No provider health data available.</p>
      )}
    </div>
  );
}