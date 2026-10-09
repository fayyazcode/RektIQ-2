/**
 * News correlation pure helpers (Phase 9).
 * Mirrors scripts/news-correlation.ts so tests and UI share deterministic logic
 * without importing the job's DB code.
 */

export const IMPACT_WINDOW_MINUTES = 60;
export const IMPACT_FORMULA_VERSION = "news-impact-v1";

export function priceAt(snaps: { timestamp: string; price: number }[], t: number): number | null {
  if (!snaps.length) return null;
  const times = snaps.map((s) => new Date(s.timestamp).getTime());
  if (t < times[0] || t > times[times.length - 1]) return null;
  for (let i = 1; i < snaps.length; i++) {
    if (times[i] >= t) {
      const t0 = times[i - 1];
      const t1 = times[i];
      if (t1 === t0) return snaps[i].price;
      const f = (t - t0) / (t1 - t0);
      return snaps[i - 1].price + f * (snaps[i].price - snaps[i - 1].price);
    }
  }
  return snaps[snaps.length - 1].price;
}

export function avgVolumeIn(snaps: { timestamp: string; volume24h: number }[], from: number, to: number): number | null {
  const inWindow = snaps.filter((s) => {
    const t = new Date(s.timestamp).getTime();
    return t >= from && t <= to;
  });
  if (!inWindow.length) return null;
  return inWindow.reduce((a, b) => a + b.volume24h, 0) / inWindow.length;
}

export function describeImpact(opts: { priceChangePct: number; windowMinutes?: number }): string {
  const w = opts.windowMinutes ?? IMPACT_WINDOW_MINUTES;
  const sign = opts.priceChangePct >= 0 ? "+" : "";
  return `Observed movement after publication: ${sign}${opts.priceChangePct.toFixed(2)}% over ${w} min (correlation, not causation).`;
}
