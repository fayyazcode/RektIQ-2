import { fmtDateTime, fmtTime, fmtDate } from "@/lib/format";

/** Always renders UTC and says so, so server and client agree and readers aren't misled. */
export default function Time({ iso, mode = "datetime", className }: { iso: string; mode?: "datetime" | "time" | "date"; className?: string }) {
  const text = mode === "time" ? `${fmtTime(iso)} UTC` : mode === "date" ? fmtDate(iso) : fmtDateTime(iso);
  return (
    <time dateTime={iso} className={className} title={fmtDateTime(iso)}>
      {text}
    </time>
  );
}
