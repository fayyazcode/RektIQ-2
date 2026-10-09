export function formatScore(score: number | null): string {
  if (score == null || !Number.isFinite(score)) return "—";
  return String(Math.round(score));
}

export function scoreTone(score: number | null): "bullish" | "neutral" | "bearish" {
  if (score == null) return "neutral";
  if (score >= 65) return "bullish";
  if (score <= 35) return "bearish";
  return "neutral";
}

export function formatPriceChange(pct: number): string {
  if (!Number.isFinite(pct) || pct === 0) return "0.00%";
  const sign = pct > 0 ? "+" : "−";
  return `${sign}${Math.abs(pct).toFixed(2)}%`;
}

export function staleLabel(stale: boolean): string {
  return stale ? "stale" : "live";
}

export function formatUsd(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 }).format(value);
}
