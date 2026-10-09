import { redirect } from "next/navigation";
import { getCurrentMember, isApprovedMember, memberStatusPath } from "@/lib/auth/member";
import PageHero from "@/components/PageHero";
import Link from "next/link";
import { getSocialSentimentWorkspace } from "@/lib/data/social-queries";

export const dynamic = "force-dynamic";

function sentimentColor(direction: string) {
  if (direction === "bullish") return "text-phosphor";
  if (direction === "bearish") return "text-danger";
  return "text-cyan";
}

function formatTime(value: string) {
  return new Date(value).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC";
}

export default async function SentimentPage() {
  const member = await getCurrentMember();
  if (!member) redirect("/member/sign-up");
  if (!isApprovedMember(member)) {
    redirect(member.status === "approved" ? "/member/pending" : memberStatusPath(member.status));
  }
  const workspace = await getSocialSentimentWorkspace();
  return (
    <div className="space-y-6">
      <PageHero variant="sentiment" kicker="MEMBER WORKSPACE" title="Social sentiment">
        <p className="text-sm md:text-base leading-relaxed">A measured view of expressed sentiment in posts from tracked crypto profiles. Signals require independent-account consensus; listed assets also require matching market movement. Newly discovered tokens can appear as social-only discoveries when market data is unavailable. Scores do not verify claims, predict prices, or recommend trades.</p>
      </PageHero>
      <section aria-labelledby="pipeline-status" className="panel grid gap-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="pipeline-status" className="label m-0 text-phosphor">Collection status</h2>
          <span className="text-xs text-muted">Fetches the latest 2 hours · analyzes stored posts up to 7 days</span>
        </div>
        <ul className="m-0 grid list-none gap-2 p-0 text-sm sm:grid-cols-2">
          <li className="flex gap-2"><span className={workspace.configuredX ? "text-phosphor" : "text-amber"} aria-hidden="true">{workspace.configuredX ? "●" : "▲"}</span>{workspace.configuredX ? `${workspace.activeProfiles} tracked profiles configured` : "X collection is waiting for the X API bearer token."}</li>
          <li className="flex gap-2"><span className={workspace.configuredAi ? "text-phosphor" : "text-amber"} aria-hidden="true">{workspace.configuredAi ? "●" : "▲"}</span>{workspace.configuredAi ? "Sentiment analysis provider configured" : "Add GEMINI_API_KEY or GROQ_API_KEY to enable analysis."}</li>
          {workspace.profilesWithErrors > 0 && <li className="text-amber sm:col-span-2">{workspace.profilesWithErrors} active profile(s) have recent collection errors. An administrator can review their status and X handles under <Link href="/admin/profiles">Admin → X Profiles</Link>.</li>}
        </ul>
        {workspace.lastRun && <p className="m-0 text-xs text-muted" role="status">Last run: {formatTime(workspace.lastRun.startedAt)} — {workspace.lastRun.status}{workspace.lastRun.message ? ` · ${workspace.lastRun.message}` : ""}</p>}
        {!workspace.lastRun && <p className="m-0 text-xs text-muted">The worker has not run yet. X signals and the separate recent-news fallback will appear after the scheduled worker processes real source data.</p>}
      </section>
      {workspace.overall && (
        <section aria-labelledby="overall-sentiment" className="panel grid gap-3 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><h2 id="overall-sentiment" className="m-0 font-mono text-xl">Overall tracked-post tone</h2><p className="m-0 mt-1 text-xs text-muted">Posts not confidently linked to a specific asset · rolling two hours</p></div>
            <span className={`font-term text-xl ${sentimentColor(workspace.overall.direction)}`}>{workspace.overall.direction}</span>
          </div>
          <p className="m-0 text-sm text-muted">{workspace.overall.sampleCount} analyzed post{workspace.overall.sampleCount === 1 ? "" : "s"} · score {workspace.overall.score > 0 ? "+" : ""}{workspace.overall.score}/100 · confidence {Math.round(workspace.overall.confidence * 100)}%</p>
        </section>
      )}
      <section aria-labelledby="latest-signals" className="grid gap-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div><h2 id="latest-signals" className="m-0 font-mono text-xl">Latest asset signals</h2><p className="m-0 mt-1 text-xs text-muted">Requires at least two independent accounts in agreement. Fast consensus uses two hours; rolling consensus uses stored posts up to seven days.</p></div>
          <Link href="/admin/profiles" className="chip-link">Tracked profiles</Link>
        </div>
        {workspace.signalsTruncated && <p className="m-0 text-xs text-amber" role="status">Showing the latest signals only; older results are hidden to keep this workspace responsive.</p>}
        {!workspace.signals.length ? (
          <div className="panel p-6">
            <p className="m-0 font-semibold">No fresh X sentiment signals.</p>
            <p className="m-0 mt-2 text-sm text-muted">{workspace.configuredX && workspace.configuredAi ? "The collector will publish signals when real posts are linked to tracked assets." : "Recent crypto-news tone appears separately as a fallback when X signals are unavailable."}</p>
          </div>
        ) : (
          <ul className="m-0 grid list-none gap-4 p-0 xl:grid-cols-2">
            {workspace.signals.map((signal) => {
              const count = signal.dimensions.sampleCount ?? 0;
              const barWidth = `${Math.max(0, Math.min(100, (signal.score + 100) / 2))}%`;
              return (
                <li key={signal.id} className="panel grid min-w-0 gap-4 p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="m-0 font-mono text-xl">{signal.marketTracked
                        ? <Link href={`/market/${encodeURIComponent(signal.symbol)}`} className="no-underline hover:text-phosphor">{signal.name} <span className="text-muted">({signal.symbol})</span></Link>
                        : <span>{signal.name} <span className="text-muted">({signal.symbol})</span></span>}</h3>
                      <p className="m-0 mt-1 text-xs text-muted">{signal.modelKind === "onchain" ? "On-chain profiles" : "Major-market profiles"} · {formatTime(signal.occurredAt)}</p>
                    </div>
                    <span className={`font-term text-xl ${sentimentColor(signal.direction)}`}>{signal.direction}</span>
                  </div>
                  <div>
                    <div className="mb-1 flex justify-between gap-3 text-xs"><span className="text-muted">Sentiment score</span><span className="font-mono">{signal.score > 0 ? "+" : ""}{signal.score}/100</span></div>
                    <div className="h-2 overflow-hidden rounded bg-panel-2" role="img" aria-label={`Sentiment score ${signal.score} out of 100`}>
                      <div className="h-full rounded bg-gradient-to-r from-danger via-amber to-phosphor" style={{ width: barWidth }} />
                    </div>
                    {signal.trend.length > 1 && (
                      <svg viewBox="0 0 100 40" className="mt-2 h-8 w-full" role="img" aria-label={`${signal.trend.length} recent sentiment readings; oldest at left`}>
                        <path d="M0 20H100" stroke="currentColor" strokeOpacity=".15" strokeDasharray="2 3" />
                        <polyline
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className={sentimentColor(signal.direction)}
                          points={signal.trend.map((value, index) => `${index / (signal.trend.length - 1) * 100},${20 - value * 0.18}`).join(" ")}
                        />
                      </svg>
                    )}
                  </div>
                  <p className="m-0 text-sm text-muted">{signal.explanation}</p>
                  <p className="m-0 text-xs text-muted">{count} analyzed post{count === 1 ? "" : "s"} · {signal.dimensions.distinctAuthors ?? 0} independent accounts · confidence {Math.round(signal.confidence * 100)}%</p>
                  {signal.dimensions.marketConfirmation === "unavailable" && <p className="m-0 text-xs text-amber">SOCIAL DISCOVERY · market confirmation unavailable</p>}
                  {signal.outcomes.length > 0 && <p className="m-0 text-xs text-muted">Price outcomes: {signal.outcomes.map((outcome) =>
                    `${outcome.horizonHours}h ${outcome.status}${outcome.returnPct === null ? "" : ` (${outcome.returnPct > 0 ? "+" : ""}${outcome.returnPct.toFixed(2)}%)`}`,
                  ).join(" · ")}</p>}
                  {signal.evidence.length > 0 && <div className="grid gap-2 border-t border-line pt-3">
                    <h4 className="label m-0">Evidence</h4>
                    {signal.evidence.map((item) => (
                      <p key={`${signal.id}-${item.sourceUrl}`} className="m-0 text-sm">
                        <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-ink hover:text-phosphor">@{item.authorHandle} on X</a>
                        <span className="text-muted"> · {item.summary}</span>
                        {item.contextReferences.map((reference) => (
                          <span key={`${reference.sourceUrl}-${reference.symbol}`} className="ml-2 text-xs text-cyan">
                            Linked to {reference.symbol} via <a href={reference.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-phosphor">earlier post</a>
                          </span>
                        ))}
                      </p>
                    ))}
                  </div>}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {workspace.weeklySignals.length > 0 && (
        <section aria-labelledby="weekly-signals" className="grid gap-3">
          <div>
            <h2 id="weekly-signals" className="m-0 font-mono text-xl">Seven-day rolling X sentiment</h2>
            <p className="m-0 mt-1 text-xs text-muted">Built from stored post analyses published in the last seven days. Older posts age out; each signal requires agreement across independent accounts.</p>
          </div>
          <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3">
            {workspace.weeklySignals.map((signal) => {
              const latestPublishedAt = signal.dimensions.latestPublishedAt;
              return (
                <li key={signal.id} className="panel grid gap-2 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    {signal.marketTracked
                      ? <Link href={`/market/${encodeURIComponent(signal.symbol)}`} className="font-mono text-lg no-underline hover:text-phosphor">{signal.name} ({signal.symbol})</Link>
                      : <span className="font-mono text-lg">{signal.name} ({signal.symbol})</span>}
                    <span className={`font-term text-lg ${sentimentColor(signal.direction)}`}>{signal.direction}</span>
                  </div>
                  <p className="m-0 text-xs text-muted">7-day score {signal.score > 0 ? "+" : ""}{signal.score}/100 · {signal.dimensions.sampleCount ?? 0} posts · confidence {Math.round(signal.confidence * 100)}%</p>
                  {typeof latestPublishedAt === "string" && <p className="m-0 text-xs text-muted">Latest source post: {formatTime(latestPublishedAt)}</p>}
                  {signal.evidence.slice(0, 2).map((item) => (
                    <p key={`${signal.id}-${item.sourceUrl}`} className="m-0 text-sm">
                      <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-ink hover:text-phosphor">@{item.authorHandle} on X</a>
                      <span className="text-muted"> · {item.summary}</span>
                      {item.contextReferences.map((reference) => (
                        <span key={`${reference.sourceUrl}-${reference.symbol}`} className="ml-2 text-xs text-cyan">
                          Linked to {reference.symbol} via <a href={reference.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-phosphor">earlier post</a>
                        </span>
                      ))}
                    </p>
                  ))}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {workspace.staleSignals.length > 0 && (
        <section aria-labelledby="stale-signals" className="grid gap-3">
          <div>
            <h2 id="stale-signals" className="m-0 font-mono text-xl">Last known X signals — stale</h2>
            <p className="m-0 mt-1 text-xs text-muted">No supporting post in the last two hours. Kept for context only; these are not current sentiment readings.</p>
          </div>
          <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2">
            {workspace.staleSignals.map((signal) => (
              <li key={signal.id} className="panel grid gap-2 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {signal.marketTracked
                    ? <Link href={`/market/${encodeURIComponent(signal.symbol)}`} className="font-mono text-lg no-underline hover:text-phosphor">{signal.name} ({signal.symbol})</Link>
                    : <span className="font-mono text-lg">{signal.name} ({signal.symbol})</span>}
                  <span className="text-xs text-amber">STALE · {signal.direction}</span>
                </div>
                <p className="m-0 text-xs text-muted">Last X signal {formatTime(signal.occurredAt)} · score {signal.score > 0 ? "+" : ""}{signal.score}/100 · {signal.dimensions.sampleCount ?? 0} posts</p>
                {signal.evidence[0] && <a href={signal.evidence[0].sourceUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-ink hover:text-phosphor">@{signal.evidence[0].authorHandle} on X · {signal.evidence[0].summary}</a>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {workspace.newsFallbacks.length > 0 && (
        <section aria-labelledby="news-fallback" className="grid gap-3">
          <div>
            <h2 id="news-fallback" className="m-0 font-mono text-xl">Recent crypto-news fallback</h2>
            <p className="m-0 mt-1 text-xs text-muted">AI-classified tone from news headlines and summaries published in the last 24 hours. Shown only for assets without a fresh X signal; this is not social-post sentiment.</p>
          </div>
          <ul className="m-0 grid list-none gap-4 p-0 xl:grid-cols-2">
            {workspace.newsFallbacks.map((item) => (
              <li key={item.symbol} className="panel grid min-w-0 gap-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link href={`/market/${encodeURIComponent(item.symbol)}`} className="font-mono text-lg no-underline hover:text-phosphor">{item.name} ({item.symbol})</Link>
                  <span className={`font-term text-lg ${sentimentColor(item.direction)}`}>{item.direction} · NEWS FALLBACK</span>
                </div>
                <p className="m-0 text-xs text-muted">{item.sampleCount} article{item.sampleCount === 1 ? "" : "s"} · score {item.score > 0 ? "+" : ""}{item.score}/100 · confidence {Math.round(item.confidence * 100)}% · latest {formatTime(item.latestAt)}</p>
                <ul className="m-0 grid list-none gap-2 border-t border-line pt-3 p-0">
                  {item.evidence.map((source) => (
                    <li key={source.url} className="text-sm">
                      <a href={source.url} target="_blank" rel="noopener noreferrer" className="text-ink hover:text-phosphor">{source.headline}</a>
                      <span className="text-xs text-muted"> · {source.source} · {source.summary}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
