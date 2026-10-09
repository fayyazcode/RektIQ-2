"use client";

import { useEffect, useState } from "react";
import { listNewsImpacts } from "@/lib/data/intel-queries";
import { NewsImpactView } from "@/lib/data/intel-queries";
import { useRealtimeOptional } from "@/components/realtime/RealtimeProvider";

export function NewsImpact() {
  const [impacts, setImpacts] = useState<NewsImpactView[]>([]);
  const rt = useRealtimeOptional();

  useEffect(() => {
    async function load() {
      const data = await listNewsImpacts({ limit: 30 });
      setImpacts(data);
    }
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, []);

  if (!rt) {
    return <p className="text-muted text-sm">Connect to realtime for live news impact.</p>;
  }

  if (impacts.length === 0) {
    return (
      <div className="p-4 text-center text-zinc-500">
        No news impact data.
      </div>
    );
  }

  return (
    <div className="space-y-3 max-h-60 sm:max-h-80 md:max-h-96 overflow-y-auto">
      {impacts.map((imp) => (
        <div
          key={imp.id}
          className="p-3 border rounded cursor-pointer hover:bg-panel transition-colors"
          onClick={() => window.dispatchEvent(new CustomEvent("news:impact:detail", { detail: imp }))}
        >
          <div className="flex justify-between items-start gap-2">
            <span className="font-mono text-sm capitalize">{imp.symbol}</span>
            <span className="text-xs text-zinc-500">{imp.formulaVersion}</span>
          </div>
          <p className="text-caption text-zinc-400 line-clamp-2">
            {imp.headline ?? "No headline"} — {"Observed movement after publication: " +
              (imp.priceChangePct >= 0 ? "+" : "") +
              `${imp.priceChangePct.toFixed(2)}% over ${imp.windowMinutes} min`}
          </p>
        </div>
      ))}
    </div>
  );
}