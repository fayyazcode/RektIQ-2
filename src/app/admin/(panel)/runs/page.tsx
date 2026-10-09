import { getRuns } from "@/lib/data/queries";
import RunsTable from "../RunsTable";

export default async function RunsPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const { kind } = await searchParams;
  const k = kind === "ingest" || kind === "daily_posts" || kind === "cleanup" || kind === "post_sync" || kind === "breaking" || kind === "summaries" ? kind : undefined;
  const runs = await getRuns(k, 100);
  return (
    <div className="grid gap-6">
      <h1 className="font-mono text-2xl m-0">Runs</h1>
      <p className="text-muted m-0 max-w-[70ch] text-sm">
        Each hourly ingest compares what the feeds return with what&apos;s already stored. <b>New</b> articles are inserted, <b>edited</b> ones are
        updated in place, <b>seen before</b> counts items already stored plus duplicates within the same fetch, and <b>merged</b> counts new
        articles that joined a story another newsroom already covered. <b>Δ prev hour</b> compares new articles with the previous run.
      </p>
      <nav className="flex max-w-full gap-2 overflow-x-auto overscroll-x-contain whitespace-nowrap pb-1 font-term text-lg" aria-label="Filter runs">
        <a href="/admin/runs" className="chip-link">All</a>
        <a href="/admin/runs?kind=ingest" className="chip-link">Ingest</a>
        <a href="/admin/runs?kind=daily_posts" className="chip-link">Posts</a>
        <a href="/admin/runs?kind=cleanup" className="chip-link">Cleanup</a>
        <a href="/admin/runs?kind=post_sync" className="chip-link">Post sync</a>
        <a href="/admin/runs?kind=breaking" className="chip-link">Breaking alerts</a>
        <a href="/admin/runs?kind=summaries" className="chip-link">Summaries</a>
      </nav>
      <section className="panel min-w-0 p-4 sm:p-5"><RunsTable runs={runs} /></section>
    </div>
  );
}
