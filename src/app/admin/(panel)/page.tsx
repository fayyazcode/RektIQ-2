import { daySlots } from "@/lib/jobs/daily-posts";
import { getPostgresDb } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import Link from "next/link";
import { getAdminStats, getFeedStates, getRuns } from "@/lib/data/queries";
import { FEEDS, RETENTION_DAYS } from "@/lib/config";
import { fmtDateTime, timeAgo } from "@/lib/format";
import { bufferConfigured, bufferDryRun } from "@/lib/social/buffer";
import { getSettings } from "@/lib/settings";
import RunsTable from "./RunsTable";
import ActionForm from "../ActionForm";
import { runJobAction, testBufferAction, testDatabaseAction } from "../actions";
import { describeConnection, inspectDatabase } from "@/lib/db-info";
import { hasSecret } from "@/lib/env";
import { and, gte, inArray } from "drizzle-orm";

export default async function Dashboard() {
  const [stats, runs, feedStates, settings, dbInfo] = await Promise.all([getAdminStats(), getRuns(undefined, 100), getFeedStates(), getSettings(), inspectDatabase()]);
  const activeSources = Array.isArray(settings.feedSources) ? settings.feedSources : FEEDS;
  const where = describeConnection();
  const feedMap = new Map(feedStates.map((f) => [f.sourceId, f]));
  const lastIngest = runs.find((run) => run.kind === "ingest");
  const lastAlertRun = runs.find((run) => run.kind === "breaking");
  const slots = daySlots(settings, new Date());
  const db = getPostgresDb();
  const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  const todayPosts = await db
    .select({
      origin: schema.outboundPosts.origin,
      status: schema.outboundPosts.status,
      slotKey: schema.outboundPosts.slotKey,
    })
    .from(schema.outboundPosts)
    .where(and(
      inArray(schema.outboundPosts.origin, ["daily", "breaking"]),
      gte(schema.outboundPosts.createdAt, today),
    ));
  const filledSlots = new Set(todayPosts
    .filter((post) => post.origin === "daily")
    .flatMap((post) => post.slotKey ? [post.slotKey] : []));
  const slotsDone = slots.filter((d) => filledSlots.has(d.toISOString())).length;
  const nextSlot = slots.find((d) => !filledSlots.has(d.toISOString()) && d > new Date());
  const alertsToday = todayPosts.filter((post) => post.origin === "breaking" && post.status !== "rejected").length;
  const checks = [
    { ok: hasSecret("GEMINI_API_KEY") || hasSecret("GROQ_API_KEY"), label: "AI provider", fix: "Add GEMINI_API_KEY (or GROQ_API_KEY). Without one, posts are headline-only." },
    { ok: bufferConfigured(), label: "Buffer", fix: "Add BUFFER_API_KEY. Until then posts are saved as dry runs." },
    ...(bufferConfigured() && bufferDryRun()
      ? [{ ok: false, label: "Dry run", fix: "BUFFER_DRY_RUN is true on this server: approving or retrying a post saves it without sending it to Buffer." }]
      : []),
    {
      ok: hasSecret("GITHUB_DISPATCH_TOKEN"),
      label: "Run-now buttons",
      fix: "They run jobs on this server. On Vercel, add GITHUB_REPO and GITHUB_DISPATCH_TOKEN so they run on GitHub Actions instead (no time limit).",
    },
    {
      ok: Boolean(lastIngest && lastIngest.status !== "failed" && Date.now() - lastIngest.startedAt.getTime() < 2 * 3600_000),
      label: "Hourly ingest",
      fix:
        lastIngest?.status === "failed"
          ? `The last run failed: ${lastIngest.error?.slice(0, 160) ?? "see Runs"}`
          : lastIngest
            ? `The last ingest recorded in this database was ${timeAgo(lastIngest.startedAt)} (${lastIngest.trigger}). If GitHub shows newer runs, the jobs are writing to a different database: compare the cluster in "Stored data" with the "Database:" line in the job's log.`
            : `No ingest has ever been recorded in this database. If GitHub shows successful runs, they're writing to a different database: compare the cluster in "Stored data" with the "Database:" line in the job's log.`,
    },
  ];

  const cards = [
    { label: "Articles, 24 h", value: stats.articles24 },
    { label: "New stories, 24 h", value: stats.stories24 },
    { label: "Multi-source stories, 24 h", value: stats.multiSource24 },
    { label: "Awaiting approval", value: stats.pending, href: "/admin/posts?status=pending_approval" },
    { label: "Failed runs, 24 h", value: stats.failedRuns24, href: "/admin/runs" },
  ];
  const storage = [
    { label: "Stories", value: dbInfo.tables.stories ?? null },
    { label: "Articles", value: dbInfo.tables.articles ?? null },
    { label: "X posts", value: dbInfo.tables.outbound_posts ?? null },
    { label: "Runs", value: dbInfo.tables.automation_runs ?? null },
  ];

  return (
    <div className="grid gap-8">
      <h1 className="font-mono text-2xl m-0">Dashboard</h1>

      <section aria-label="Totals" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
        {cards.map((c) => {
          const body = (
            <>
              <p className="label m-0">{c.label}</p>
              <p className="m-0 mt-2 break-words font-mono text-2xl sm:text-3xl">{c.value}</p>
            </>
          );
          return c.href ? <Link key={c.label} href={c.href} className="panel p-4 no-underline hover:border-phosphor-dim">{body}</Link> : <div key={c.label} className="panel p-4">{body}</div>;
        })}
      </section>

      <section aria-labelledby="storage" className="panel min-w-0 p-4 sm:p-5">
        <h2 id="storage" className="label m-0 mb-3 text-phosphor">Stored data</h2>
        <p className="text-sm m-0 mb-4">
          Connected to Supabase PostgreSQL database <b className="font-mono text-phosphor">{where?.database}</b> on{" "}
          <b className="font-mono text-phosphor break-all">{where?.cluster}</b>. Check Supabase → Project Settings → Database if this host is unexpected.
          Estimated table rows (may lag recent writes):{" "}
          <span className="font-mono text-muted">
            {Object.keys(dbInfo.tables).length
              ? Object.entries(dbInfo.tables).map(([name, count]) => `${name} (${count === null ? "unknown" : `~${count.toLocaleString("en-US")}`})`).join(", ")
              : "none yet"}
          </span>
        </p>
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 m-0 font-mono">
          {storage.map((s) => (
            <div key={s.label}><dt className="text-muted text-sm">{s.label}</dt><dd className="m-0 text-xl">{s.value === null ? "Unknown" : `~${s.value.toLocaleString("en-US")}`}</dd></div>
          ))}
        </dl>
        <p className="text-sm text-muted m-0 mt-3">
          Oldest story: {stats.oldestStory ? fmtDateTime(stats.oldestStory) : "none yet"}. Everything older than {RETENTION_DAYS} days is removed by the
          daily cleanup{stats.lastCleanup ? `, last run ${timeAgo(stats.lastCleanup)}` : ", which hasn't run yet"}.
        </p>
      </section>

      <section aria-labelledby="health" className="panel min-w-0 p-4 sm:p-5">
        <h2 id="health" className="label m-0 mb-3 text-phosphor">Setup and health</h2>
        <ul className="grid gap-2 list-none p-0 m-0 text-sm">
          {checks.map((c) => (
            <li key={c.label} className="flex gap-3">
              <span className={c.ok ? "text-phosphor" : "text-amber"} aria-hidden="true">{c.ok ? "●" : "▲"}</span>
              <span className="min-w-0 break-words"><b className="font-semibold">{c.label}</b>{c.ok ? " is working." : `: ${c.fix}`}</span>
            </li>
          ))}
          <li className="flex gap-3">
            <span className={settings.breakingEnabled ? "text-phosphor" : "text-amber"} aria-hidden="true">{settings.breakingEnabled ? "●" : "▲"}</span>
            <span className="min-w-0 break-words">
              <b className="font-semibold">Breaking alerts</b>{" "}
              {settings.breakingEnabled
                ? `are on (${settings.breakingSensitivity}): ${alertsToday} of ${settings.breakingMaxPerDay} sent today${lastAlertRun?.message ? `. Last check: ${lastAlertRun.message}` : "."}`
                : "are off. Important stories wait for the daily set."}
            </span>
          </li>
          <li className="flex gap-3">
            <span className={settings.postingEnabled ? "text-phosphor" : "text-amber"} aria-hidden="true">{settings.postingEnabled ? "●" : "▲"}</span>
            <span>
              <b className="font-semibold">Daily posts</b> are {settings.postingEnabled ? "on" : "off"}
              {settings.requireApproval ? ", with approval before sending" : ""}: {slotsDone} of {slots.length} done today
              {nextSlot ? `, next at ${nextSlot.toISOString().slice(11, 16)} UTC` : ""}.
            </span>
          </li>
        </ul>
      </section>

      <section aria-labelledby="run-now" className="panel grid min-w-0 gap-4 p-4 sm:p-5">
        <h2 id="run-now" className="label m-0 text-phosphor">Run now</h2>
        <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-3">
          <ActionForm action={runJobAction} submit="Check feeds now"><input type="hidden" name="job" value="ingest" /></ActionForm>
          <ActionForm action={runJobAction} submit="Write remaining posts now" className="grid min-w-0 gap-2">
            <input type="hidden" name="job" value="posts" />
            <label className="flex items-center gap-2 text-sm text-muted"><input type="checkbox" name="force" defaultChecked /> All of today&apos;s remaining slots (one extra post if none are left)</label>
          </ActionForm>
          <ActionForm action={testDatabaseAction} submit="Test database connection" variant="btn btn-ghost" />
          <ActionForm action={testBufferAction} submit="Test Buffer connection" variant="btn btn-ghost" />
          <ActionForm action={runJobAction} submit="Sync posts from Buffer" variant="btn btn-ghost"><input type="hidden" name="job" value="sync" /></ActionForm>
          <ActionForm action={runJobAction} submit="Clean up old data" variant="btn btn-ghost"><input type="hidden" name="job" value="cleanup" /></ActionForm>
        </div>
      </section>

      <section aria-labelledby="feeds" className="panel min-w-0 p-4 sm:p-5">
        <h2 id="feeds" className="label m-0 mb-3 text-phosphor">Feeds</h2>
        <div className="table-scroll">
          <table className="w-full text-sm font-mono min-w-[36rem]">
            <tbody>
              {activeSources.map((f) => {
                const s = feedMap.get(f.id);
                const failing = (s?.consecutiveFailures ?? 0) > 0;
                return (
                  <tr key={f.id} className="border-b border-line last:border-0">
                    <th scope="row" className="text-left font-normal py-2 pr-3">{f.name}</th>
                    <td className={`py-2 pr-3 ${failing ? "text-danger" : "text-phosphor"}`}>{s ? (failing ? `failing ×${s.consecutiveFailures}` : "ok") : "never checked"}</td>
                    <td className="py-2 pr-3 text-muted">{s?.lastSuccessAt ? `last ok ${timeAgo(s.lastSuccessAt)}` : ""}</td>
                    <td className="py-2 text-muted">{failing ? s?.lastError : `${s?.lastItemCount ?? 0} items`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="recent" className="panel min-w-0 p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id="recent" className="label m-0 text-phosphor">Recent runs</h2>
          <Link href="/admin/runs" className="font-term text-lg text-muted">All runs</Link>
        </div>
        <RunsTable runs={runs.slice(0, 8)} />
      </section>
    </div>
  );
}
