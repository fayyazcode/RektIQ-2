import { fmtDateTime } from "@/lib/format";
import type { getRuns } from "@/lib/data/queries";

type RunRecord = Awaited<ReturnType<typeof getRuns>>[number];

const STATUS_COLOR: Record<string, string> = {
  success: "text-phosphor", partial: "text-amber", failed: "text-danger", running: "text-cyan", skipped: "text-muted",
};

function statNumber(stats: Record<string, unknown> | null, key: string) {
  const value = stats?.[key];
  return typeof value === "number" ? value : undefined;
}

function statSum(stats: Record<string, unknown> | null, ...keys: string[]) {
  const values = keys.map((key) => statNumber(stats, key));
  return values.every((value): value is number => value !== undefined)
    ? values.reduce((sum, value) => sum + value, 0)
    : undefined;
}

export default function RunsTable({ runs }: { runs: RunRecord[] }) {
  if (!runs.length) return <p className="text-muted">No runs yet. They appear after the first scheduled or manual run.</p>;
  return (
    <div className="table-scroll w-full max-w-full overscroll-x-contain">
      <table className="w-full text-sm font-mono border-collapse min-w-[48rem]">
        <thead>
          <tr className="text-left text-muted border-b border-line">
            <th className="py-2 pr-3 font-normal">Started</th>
            <th className="py-2 pr-3 font-normal">Job</th>
            <th className="py-2 pr-3 font-normal">Status</th>
            <th className="py-2 pr-3 font-normal text-right">New</th>
            <th className="py-2 pr-3 font-normal text-right">Edited</th>
            <th className="py-2 pr-3 font-normal text-right">Seen before</th>
            <th className="py-2 pr-3 font-normal text-right">Merged</th>
            <th className="py-2 pr-3 font-normal text-right">Δ prev hour</th>
            <th className="py-2 font-normal">Notes</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id} className="border-b border-line align-top">
              <td className="py-2 pr-3 whitespace-nowrap">{fmtDateTime(r.startedAt)}</td>
              <td className="py-2 pr-3">{r.kind === "ingest" ? "Ingest" : r.kind === "cleanup" ? "Cleanup" : r.kind === "post_sync" ? "Post sync" : r.kind === "breaking" ? "Breaking alert" : r.kind === "summaries" ? "Summaries" : "Daily posts"}<span className="text-dim"> · {r.trigger}</span></td>
              <td className={`py-2 pr-3 ${STATUS_COLOR[r.status] ?? "text-muted"}`}>{r.status}</td>
              <td className="py-2 pr-3 text-right">{r.kind === "ingest" ? statNumber(r.stats, "inserted") ?? "–" : r.kind === "daily_posts" || r.kind === "breaking" ? r.postsCreated ?? "–" : r.kind === "post_sync" ? r.counts?.inserted ?? "–" : r.kind === "summaries" ? r.counts?.written ?? "–" : "–"}</td>
              <td className="py-2 pr-3 text-right">{statNumber(r.stats, "updated") ?? r.counts?.updated ?? "–"}</td>
              <td className="py-2 pr-3 text-right">{statSum(r.stats, "unchanged", "duplicatesInBatch") ?? "–"}</td>
              <td className="py-2 pr-3 text-right">{statNumber(r.stats, "mergedIntoStories") ?? "–"}</td>
              <td className="py-2 pr-3 text-right">{typeof r.deltaVsPrevious?.insertedDiff === "number" ? `${r.deltaVsPrevious.insertedDiff >= 0 ? "+" : ""}${r.deltaVsPrevious.insertedDiff}` : "–"}</td>
              <td className="py-2 text-muted max-w-[28rem]">
                {r.message}
                {r.error && <span className="block text-danger break-words">{r.error.slice(0, 300)}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
