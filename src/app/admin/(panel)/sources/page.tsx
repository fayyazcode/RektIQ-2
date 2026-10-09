import ActionForm from "@/app/admin/ActionForm";
import { getFeedSources } from "@/lib/feeds/registry";
import { getFeedStates } from "@/lib/data/queries";
import { getSettings } from "@/lib/settings";
import { fmtDateTime } from "@/lib/format";
import { removeFeedSourceAction, saveFeedSourceAction, toggleSourceAction } from "../../actions";

export const dynamic = "force-dynamic";

export default async function AdminSources() {
  const [feeds, states, settings] = await Promise.all([getFeedSources(), getFeedStates(), getSettings()]);
  const byId = new Map(states.map((state) => [state.sourceId, state]));
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="m-0 font-mono text-2xl">RSS sources</h1>
        <p className="mt-2 max-w-[70ch] text-sm text-muted">Add, edit, pause, or remove publisher feeds. Changes apply to the next scheduled ingest. Removing a feed keeps stories already collected.</p>
      </div>

      <section className="panel grid gap-4 p-4 sm:p-5" aria-labelledby="add-feed-title">
        <div>
          <h2 id="add-feed-title" className="m-0 font-mono text-lg">Add a feed</h2>
          <p className="m-0 mt-1 text-xs text-muted">Use the publisher&apos;s direct HTTPS RSS or Atom feed URL.</p>
        </div>
        <ActionForm action={saveFeedSourceAction} submit="Add source" className="grid gap-4">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1"><span className="label">Publisher name</span><input className="input" name="name" required minLength={2} maxLength={80} placeholder="Example: CoinDesk" /></label>
            <label className="grid gap-1"><span className="label">RSS / Atom URL</span><input className="input" name="url" type="url" required placeholder="https://example.com/rss.xml" /></label>
            <label className="grid gap-1"><span className="label">Publisher homepage <span className="text-dim">optional</span></span><input className="input" name="homepage" type="url" placeholder="Defaults to the feed website" /></label>
            <label className="grid gap-1"><span className="label">Short description <span className="text-dim">optional</span></span><input className="input" name="blurb" maxLength={240} placeholder="Markets and industry reporting" /></label>
          </div>
        </ActionForm>
      </section>

      <section className="grid gap-4" aria-labelledby="managed-feeds-title">
        <h2 id="managed-feeds-title" className="m-0 font-mono text-lg">Managed feeds <span className="text-sm text-muted">{feeds.length} / 50</span></h2>
        {feeds.length ? (
          <div className="grid gap-4 xl:grid-cols-2">
            {feeds.map((feed) => {
              const state = byId.get(feed.id);
              const enabled = !settings.disabledSources.includes(feed.id);
              return (
                <section key={feed.id} className="panel grid min-w-0 gap-3 p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="m-0 break-words font-mono text-lg">{feed.name}</h3>
                      <p className="m-0 mt-1 break-all text-xs text-muted">{feed.url}</p>
                    </div>
                    <span className={`chip ${enabled ? "text-phosphor" : "text-muted"}`}>{enabled ? "On" : "Off"}</span>
                  </div>

                  <dl className="m-0 grid grid-cols-[minmax(7rem,9rem)_minmax(0,1fr)] gap-x-2 gap-y-1 text-xs">
                    <dt className="text-muted">Last success</dt><dd className="m-0">{state?.lastSuccessAt ? fmtDateTime(state.lastSuccessAt) : "Never"}</dd>
                    <dt className="text-muted">Items last fetch</dt><dd className="m-0">{state?.lastItemCount ?? 0}</dd>
                    <dt className="text-muted">Failures in a row</dt><dd className={`m-0 ${state?.consecutiveFailures ? "text-danger" : ""}`}>{state?.consecutiveFailures ?? 0}</dd>
                    <dt className="text-muted">Request caching</dt><dd className="m-0">{state?.etag || state?.lastModified ? "Conditional requests" : "Full download"}</dd>
                    {state?.lastError && <><dt className="text-muted">Last error</dt><dd className="m-0 break-words text-danger">{state.lastError}</dd></>}
                  </dl>

                  <details className="border-t border-line pt-3">
                    <summary className="cursor-pointer text-sm font-semibold">Edit source details</summary>
                    <ActionForm action={saveFeedSourceAction} submit="Save changes" className="mt-3 grid gap-3">
                      <input type="hidden" name="sourceId" value={feed.id} />
                      <label className="grid gap-1"><span className="label">Publisher name</span><input className="input" name="name" required minLength={2} maxLength={80} defaultValue={feed.name} /></label>
                      <label className="grid gap-1"><span className="label">RSS / Atom URL</span><input className="input" name="url" type="url" required defaultValue={feed.url} /></label>
                      <label className="grid gap-1"><span className="label">Publisher homepage</span><input className="input" name="homepage" type="url" defaultValue={feed.homepage} /></label>
                      <label className="grid gap-1"><span className="label">Short description</span><input className="input" name="blurb" maxLength={240} defaultValue={feed.blurb} /></label>
                    </ActionForm>
                  </details>

                  <div className="flex flex-wrap gap-2 border-t border-line pt-3">
                    <form action={toggleSourceAction}>
                      <input type="hidden" name="source" value={feed.id} />
                      <input type="hidden" name="enable" value={enabled ? "0" : "1"} />
                      <button className="btn btn-ghost" type="submit">{enabled ? "Pause feed" : "Resume feed"}</button>
                    </form>
                    <ActionForm action={removeFeedSourceAction} submit="Remove feed" variant="btn btn-ghost">
                      <input type="hidden" name="sourceId" value={feed.id} />
                    </ActionForm>
                  </div>
                </section>
              );
            })}
          </div>
        ) : <div className="panel p-5 text-sm text-muted">No active feeds. Add an RSS source above to resume ingestion.</div>}
      </section>
    </div>
  );
}
