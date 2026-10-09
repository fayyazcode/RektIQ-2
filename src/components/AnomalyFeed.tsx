"use client";

import { useEffect, useState } from "react";
import { listAnomalies } from "@/lib/data/intel-queries";
import { useRealtimeOptional } from "@/components/realtime/RealtimeProvider";

export function AnomalyFeed() {
  const [anomalies, setAnomalies] = useState<any[]>([]);
  const rt = useRealtimeOptional();

  useEffect(() => {
    async function load() {
      const data = await listAnomalies({ limit: 30 });
      setAnomalies(data);
    }
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, []);

  if (!rt) {
    return <p className="text-muted text-sm">Connect to realtime for live anomalies.</p>;
  }

  if (anomalies.length === 0) {
    return <div className="p-4 text-center text-zinc-500">No anomalies detected.</div>;
  }

  const sevColor = (sev: "low" | "medium" | "high") => {
    if (sev === "high") return "text-red-400";
    if (sev === "medium") return "text-amber-400";
    return "text-emerald-400";
  };

  return (
    <div className="space-y-3 max-h-60 sm:max-h-80 md:max-h-96 overflow-y-auto">
      {anomalies.map((a) => (
        <div
          key={a.id}
          className="p-3 border rounded cursor-pointer hover:bg-panel transition-colors"
          onClick={() =>
            window.dispatchEvent(new CustomEvent("anomaly:detail", { detail: a }))
          }
        >
          <div className="flex justify-between items-start gap-2">
            <span className="font-mono text-sm capitalize">{a.symbol}</span>
            <span className={`text-${sevColor(a.severity)} text-xs font-medium`}>
              {a.severity}
            </span>
          </div>
          <p className="text-caption text-zinc-400 line-clamp-2">
            {`${a.type.replace(/_/g, " ")} — ratio: ${a.ratio?.toFixed(2)}× observed: ${a.observed}`}
          </p>
        </div>
      ))}
    </div>
  );
}