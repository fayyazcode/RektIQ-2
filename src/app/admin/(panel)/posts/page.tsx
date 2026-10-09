import { bufferDryRun } from "@/lib/social/buffer";
import Link from "next/link";
import { getAdminPosts } from "@/lib/data/queries";
import { fmtDateTime } from "@/lib/format";
import { xLength, X_LIMIT } from "@/lib/social/tweet";
import type { PostStatus } from "@/lib/types";
import ActionForm from "../../ActionForm";
import { createManualPostAction, sendPostAction, updatePostStatusAction } from "../../actions";

const STATUSES: PostStatus[] = ["pending_approval", "scheduled", "sent", "failed", "dry_run", "rejected"];
const LABEL: Record<PostStatus, string> = { pending_approval: "Awaiting approval", scheduled: "Scheduled", sent: "Sent", failed: "Failed", dry_run: "Dry run", rejected: "Rejected" };

export default async function PostsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const s = STATUSES.includes(status as PostStatus) ? (status as PostStatus) : undefined;
  const posts = await getAdminPosts(s);
  const defaultTime = new Date(Date.now() + 3600_000).toISOString().slice(0, 16);

  return (
    <div className="grid gap-6">
      <h1 className="font-mono text-2xl m-0">Post queue</h1>
      {bufferDryRun() && (
        <p role="status" className="panel p-4 m-0 text-sm text-amber border-amber/50">
          Dry run is on for this website (BUFFER_DRY_RUN=true on Vercel, or no BUFFER_API_KEY). Approve and Retry save the post here without sending it to
          Buffer. The daily job follows the BUFFER_DRY_RUN variable in GitHub instead.
        </p>
      )}
      <nav className="flex flex-wrap gap-2" aria-label="Filter posts">
        <Link href="/admin/posts" className="chip-link">All</Link>
        {STATUSES.map((x) => <Link key={x} href={`/admin/posts?status=${x}`} className="chip-link" aria-current={x === s ? "page" : undefined}>{LABEL[x]}</Link>)}
      </nav>

      <details className="panel min-w-0 p-4 sm:p-5">
        <summary className="font-term text-xl text-phosphor cursor-pointer">Write a post</summary>
        <ActionForm action={createManualPostAction} submit="Add to queue" className="grid gap-3 mt-4">
          <textarea name="content" className="input min-h-28" maxLength={1000} required placeholder="Post text. Add a link at the end if you want one." />
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="grid gap-1"><span className="label">Type</span>
              <select name="kind" className="input" defaultValue="breaking">
                <option value="breaking">Breaking</option><option value="market">Market update</option><option value="insight">Trend</option>
              </select>
            </label>
            <label className="grid gap-1"><span className="label">Send at (UTC)</span>
              <input type="datetime-local" name="scheduledAt" className="input" defaultValue={defaultTime} required />
            </label>
          </div>
        </ActionForm>
      </details>

      {posts.length === 0 && <p className="text-muted">No posts here yet.</p>}
      <ul className="grid gap-4 list-none p-0 m-0">
        {posts.map((p) => {
          const editable = p.status !== "scheduled" && p.status !== "sent" && p.status !== "rejected";
          const len = xLength(p.content);
          return (
            <li key={p.id} className="panel grid min-w-0 gap-3 p-4 sm:p-5">
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm font-mono text-muted">
                <span className={p.status === "failed" ? "text-danger" : p.status === "scheduled" || p.status === "sent" ? "text-phosphor" : "text-amber"}>{LABEL[p.status]}</span>
                <span>{p.origin === "breaking" ? "breaking alert" : p.kind}</span>
                {p.style && <span className={p.style === "humor" ? "text-cyan" : ""}>{p.style === "link" ? "with link" : p.style === "detailed" ? "detailed, no link" : "humor, no link"}</span>}
                <span>{fmtDateTime(p.scheduledAt)}</span>
                <span>written by {p.writtenBy}</span>
                <span className={len > X_LIMIT ? "text-danger" : ""}>{len}/{X_LIMIT}</span>
              </div>
              {p.storyTitle && <p className="m-0 break-words text-sm">Story: <Link href={`/story/${p.storySlug}`}>{p.storyTitle}</Link></p>}
              {p.reason && <p className="m-0 break-words text-sm text-muted">Why now: {p.reason}</p>}
              {p.error && <p role="alert" className="m-0 break-words text-sm text-danger">{p.error}</p>}
              {editable ? (
                <ActionForm action={sendPostAction} submit={p.status === "failed" ? "Retry sending" : "Approve and send"} className="grid gap-3">
                  <input type="hidden" name="id" value={p.id} />
                  <label className="grid gap-1">
                    <span className="sr-only">Post text</span>
                    <textarea name="content" className="input min-h-28" defaultValue={p.content} />
                  </label>
                </ActionForm>
              ) : (
                <p className="m-0 whitespace-pre-line">{p.content}</p>
              )}
              {p.externalUrl && <a href={p.externalUrl} target="_blank" rel="noopener" className="text-sm text-phosphor">View on X ↗</a>}
              {p.status !== "scheduled" && p.status !== "sent" && (
                <div className="flex gap-2">
                  {p.status !== "rejected" && (
                    <form action={updatePostStatusAction}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="op" value="reject" /><button className="btn btn-ghost">Reject</button></form>
                  )}
                  <form action={updatePostStatusAction}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="op" value="delete" /><button className="btn btn-danger">Delete</button></form>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
