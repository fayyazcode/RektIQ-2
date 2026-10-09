import { getFeedSourceById } from "@/lib/feeds/registry";

export default async function SourceGlyph({ source, withName = true }: { source: string; withName?: boolean }) {
  const f = await getFeedSourceById(source);
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className="inline-grid place-items-center w-5 h-5 rounded-sm border border-line text-phosphor text-xs font-mono">
        {f?.glyph ?? "•"}
      </span>
      {withName && <span>{f?.name ?? source}</span>}
    </span>
  );
}
