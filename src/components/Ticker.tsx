import type { Price } from "@/lib/prices";
import { fmtPct, fmtUsd } from "@/lib/format";

export default function Ticker({ prices }: { prices: Price[] }) {
  if (!prices.length) return null;
  const items = prices.map((p) => (
    <span key={p.id} className="px-5 whitespace-nowrap">
      <span className="text-ink">{p.symbol}</span> {fmtUsd(p.usd)}{" "}
      <span className={p.change24h >= 0 ? "text-up" : "text-down"}>
        <span aria-hidden="true">{p.change24h >= 0 ? "▲" : "▼"}</span> {fmtPct(p.change24h)}
      </span>
    </span>
  ));
  return (
    <div className="ticker overflow-hidden border-b border-line bg-panel font-term text-sm sm:text-lg text-muted py-1" aria-label="Prices from CoinGecko, updated every 5 minutes" tabIndex={0}>
      <div className="ticker-track">
        <div className="flex">{items}</div>
        <div className="flex ticker-dup" aria-hidden="true">{items}</div>
      </div>
    </div>
  );
}
