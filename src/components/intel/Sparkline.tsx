/** Compact seven-day price chart for dense market tables. */
export function Sparkline({ values, symbol }: { values?: number[]; symbol: string }) {
  const points = values?.filter((value) => Number.isFinite(value) && value > 0) ?? [];
  if (points.length < 2) {
    return <span className="font-mono text-xs text-dim" title={`Seven-day chart unavailable for ${symbol}`}>—</span>;
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min;
  const coords = points.map((value, index) => {
    const x = (index / (points.length - 1)) * 96 + 2;
    const y = span === 0 ? 16 : 29 - ((value - min) / span) * 26;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const rising = points[points.length - 1] >= points[0];
  const color = rising ? "#4ade80" : "#ff6b6b";

  return (
    <svg
      viewBox="0 0 100 32"
      className="h-8 w-24 overflow-visible"
      role="img"
      aria-label={`${symbol} seven-day price trend, ${rising ? "up" : "down"}`}
      preserveAspectRatio="none"
    >
      <title>{`${symbol} price over seven days`}</title>
      <polyline points={coords.join(" ")} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
