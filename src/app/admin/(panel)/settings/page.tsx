import { stylesFor } from "@/lib/ai/prompt";
import { daySlots } from "@/lib/jobs/daily-posts";
import { getSettings } from "@/lib/settings";
import ActionForm from "../../ActionForm";
import { addMarketWatchlistSymbolAction, removeMarketWatchlistSymbolAction, saveSettingsAction } from "../../actions";

export default async function SettingsPage() {
  const s = await getSettings();
  const slots = daySlots(s, new Date());
  return (
    <div className="grid gap-6 max-w-2xl">
      <h1 className="font-mono text-2xl m-0">Settings</h1>
      <ActionForm action={saveSettingsAction} submit="Save settings" className="panel grid min-w-0 gap-5 p-4 sm:p-5">
        <label className="flex gap-3 items-start">
          <input type="checkbox" name="postingEnabled" defaultChecked={s.postingEnabled} className="mt-1" />
          <span className="min-w-0"><b>Post to X every day</b><span className="block text-sm text-muted">When off, the daily job skips writing posts. News still updates hourly.</span></span>
        </label>
        <label className="flex gap-3 items-start">
          <input type="checkbox" name="requireApproval" defaultChecked={s.requireApproval} className="mt-1" />
          <span className="min-w-0"><b>Approve posts before they&apos;re sent</b><span className="block text-sm text-muted">Posts wait in the queue until you approve them.</span></span>
        </label>
        <fieldset className="grid gap-4 m-0 p-0 border-0">
          <legend className="font-term text-xl text-phosphor mb-2">Daily posts</legend>
          <label className="grid gap-1">
            <span className="label">Posts per day</span>
            <input type="number" name="postsPerDay" min={1} max={24} step={1} className="input max-w-32" defaultValue={s.postsPerDay} required />
          </label>
          <div className="grid sm:grid-cols-2 gap-4">
            <label className="grid gap-1">
              <span className="label">Posting window starts (UTC)</span>
              <input type="time" name="postWindowStartUtc" className="input" defaultValue={s.postWindowStartUtc} required />
            </label>
            <label className="grid gap-1">
              <span className="label">Posting window ends (UTC)</span>
              <input type="time" name="postWindowEndUtc" className="input" defaultValue={s.postWindowEndUtc} required />
            </label>
          </div>
          <label className="grid gap-1">
            <span className="label">Exact send times (optional, UTC, comma separated)</span>
            <input name="postTimesUtc" className="input" defaultValue={s.postTimesUtc.join(", ")} placeholder="Leave empty to spread posts evenly" />
          </label>
          <p className="text-sm text-muted m-0">
            Today&apos;s schedule: <span className="font-mono text-ink">{slots.map((d) => d.toISOString().slice(11, 16)).join(", ")}</span> UTC.
            If you list at least as many exact times as posts per day, those are used; otherwise posts are spread evenly across the window.
            Each post is written about 2 hours before its time from the freshest top stories.
          </p>
          <div className="grid gap-2">
            <span className="label">Post style mix (adds up to 100%)</span>
            <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-3 max-w-lg">
              <label className="grid gap-1 text-sm">With website link<input type="number" name="mixLink" min={0} max={100} className="input" defaultValue={s.postMix.link} required /></label>
              <label className="grid gap-1 text-sm">Detailed, no link<input type="number" name="mixDetailed" min={0} max={100} className="input" defaultValue={s.postMix.detailed} required /></label>
              <label className="grid gap-1 text-sm">Humor<input type="number" name="mixHumor" min={0} max={100} className="input" defaultValue={s.postMix.humor} required /></label>
            </div>
            <p className="text-sm text-muted m-0">
              <b>With link:</b> a short hook and a link to the story on this site. <b>Detailed:</b> the complete story in the post (what, who, the
              numbers, why it matters, credited to the newsroom), no link. <b>Humor:</b> a light, funny take with the real facts inside; never used
              on serious stories (hacks, scams, arrests, losses). Today&apos;s styles:{" "}
              <span className="font-mono text-ink">{stylesFor(slots.length, s.postMix).join(", ")}</span>. Set humor to 0 to turn it off.
            </p>
          </div>
        </fieldset>
        <fieldset className="grid gap-4 m-0 p-0 border-0">
          <legend className="font-term text-xl text-phosphor mb-2">Story summaries</legend>
          <label className="grid gap-1">
            <span className="label">AI summaries per day</span>
            <input type="number" name="summariesPerDay" min={0} max={200} className="input max-w-32" defaultValue={s.summariesPerDay} required />
            <span className="text-sm text-muted">
              Major stories (2+ newsrooms, high-impact or high-scoring) get an original summary on their page, refreshed when more newsrooms join.
              At most 8 per hourly run. About 30–50 a day fits the free Gemini tier alongside the posts; 0 turns summaries off.
            </span>
          </label>
        </fieldset>
        <fieldset className="grid gap-4 border-t border-line pt-5 m-0 p-0 border-0 border-t-[1px]">
          <legend className="font-term text-xl text-phosphor mb-2">Breaking alerts</legend>
          <label className="flex gap-3 items-start">
            <input type="checkbox" name="breakingEnabled" defaultChecked={s.breakingEnabled} className="mt-1" />
            <span>
              <b>Post important stories within the hour</b>
              <span className="block text-sm text-muted">
                After every hourly check, the most important new story is posted straight away instead of waiting for the daily set. It follows the
                approval setting above.
              </span>
            </span>
          </label>
          <label className="grid gap-1">
            <span className="label">What counts as important</span>
            <select name="breakingSensitivity" className="input max-w-md" defaultValue={s.breakingSensitivity}>
              <option value="strict">Only the biggest: 3+ newsrooms, or 2+ with a high-impact headline</option>
              <option value="normal">Important: 2+ newsrooms, or a high-impact headline (hack, approval, lawsuit…)</option>
              <option value="relaxed">More alerts: any story that scores high enough</option>
            </select>
          </label>
          <div className="grid sm:grid-cols-2 gap-4">
            <label className="grid gap-1">
              <span className="label">Most alerts per day</span>
              <select name="breakingMaxPerDay" className="input" defaultValue={String(s.breakingMaxPerDay)}>
                {[1, 2, 3, 4, 5, 6, 8, 10].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label className="grid gap-1">
              <span className="label">At least this long between alerts</span>
              <select name="breakingMinGapMinutes" className="input" defaultValue={String(s.breakingMinGapMinutes)}>
                {[30, 60, 90, 120, 180, 240].map((n) => <option key={n} value={n}>{n < 60 ? `${n} minutes` : `${n / 60} hour${n > 60 ? "s" : ""}`}</option>)}
              </select>
            </label>
          </div>
          <p className="text-sm text-muted m-0">
            Only stories first reported in the last 3 hours qualify, and a story is never posted twice. Alerts are checked right after each hourly
            ingest, so they go out as reliably as that job runs.
          </p>
        </fieldset>
      </ActionForm>
      <section className="panel grid gap-4 p-4 sm:p-5" aria-labelledby="market-watchlist-title">
        <div>
          <h2 id="market-watchlist-title" className="font-term text-xl text-phosphor m-0">Realtime scoring watchlist</h2>
          <p className="text-sm text-muted mt-2 mb-0">
            These coins are fetched by the realtime worker and receive persistent scores and signal checks. The Market page can still show other coins with an estimated score.
            Add a ticker symbol, such as ZEC. Changes apply on the next worker tick; removing a coin keeps its historical signals and market snapshots.
          </p>
        </div>
        <ActionForm action={addMarketWatchlistSymbolAction} submit="Add coin" className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <label className="grid min-w-0 gap-1">
            <span className="label">Ticker symbol</span>
            <input name="symbol" className="input w-full sm:max-w-xs" placeholder="e.g. ZEC" maxLength={20} autoComplete="off" required />
          </label>
        </ActionForm>
        <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2 lg:grid-cols-3">
          {(s.marketWatchlist ?? []).map((symbol) => (
            <li key={symbol} className="flex min-w-0 items-center justify-between gap-3 rounded border border-line bg-panel-2 px-3 py-2">
              <span className="font-mono text-ink">{symbol}</span>
              <ActionForm action={removeMarketWatchlistSymbolAction} submit="Remove" variant="btn btn-ghost !min-h-0 !px-2 !py-1 !text-sm" className="shrink-0">
                <input type="hidden" name="symbol" value={symbol} />
              </ActionForm>
            </li>
          ))}
          {s.marketWatchlist?.length === 0 && <li className="text-sm text-muted sm:col-span-2 lg:col-span-3">No coins tracked by the realtime worker. Market page estimates remain available for its provider results.</li>}
        </ul>
      </section>
      <section className="panel p-5 text-sm text-muted">
        <h2 className="label m-0 mb-2 text-phosphor">Secrets</h2>
        <p className="m-0">API keys and database connection strings live in environment variables and GitHub secrets, never in the database or the browser.</p>
      </section>
    </div>
  );
}
