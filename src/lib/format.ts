/** All user-facing times are shown in UTC and labeled as such. */
const utc = { timeZone: "UTC" } as const;

export const fmtUsd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n >= 1000 ? 0 : n < 1 ? 4 : 2 });
export const fmtPct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
export const fmtTime = (iso: string | Date) => new Date(iso).toLocaleTimeString("en-GB", { ...utc, hour: "2-digit", minute: "2-digit" });
export const fmtDate = (iso: string | Date) => new Date(iso).toLocaleDateString("en-GB", { ...utc, day: "numeric", month: "short", year: "numeric" });
export const fmtDateTime = (iso: string | Date) => `${fmtDate(iso)}, ${fmtTime(iso)} UTC`;

export function timeAgo(iso: string | Date, now = Date.now()) {
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
