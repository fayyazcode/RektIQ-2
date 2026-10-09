import Link from "next/link";
import { SITE } from "@/lib/config";
import { getFeedSources } from "@/lib/feeds/registry";
import { getLastIngest, getPublicPosts, getSourceCounts, getStories, getTopStories } from "@/lib/data/queries";
import { hasDatabase } from "@/lib/db";
import { getPrices } from "@/lib/prices";
import { fmtPct, fmtUsd, timeAgo } from "@/lib/format";
import { CATEGORY_LABELS } from "@/lib/normalize/categories";
import StoryList from "@/components/StoryList";
import SourceGlyph from "@/components/SourceGlyph";
import LiveUpdates from "@/components/LiveUpdates";
import JsonLd from "@/components/JsonLd";
import Time from "@/components/Time";
import { ClickableCoinRow } from "@/components/intel/ClickableCoinRow";
import SetupNotice from "@/components/SetupNotice";
import DbNotice from "@/components/DbNotice";
import HeroNetwork from "@/components/HeroNetwork";

// Rendered per request; the data itself comes from the cached queries in lib/data/queries.
// (A statically cached page could freeze a "database still connecting" render for minutes.)
export const dynamic = "force-dynamic";

export default async function Home() {
  const [top, latest, posts, counts, last, prices, feedSources] = await Promise.all([
    getTopStories(5),
    getStories({ perPage: 20, withTotal: false }),
    getPublicPosts(3),
    getSourceCounts(24),
    getLastIngest(),
    getPrices(),
    getFeedSources(),
  ]);
  const [lead, ...others] = top;
  const renderedAt = new Date().toISOString();
  const articles24 = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: SITE.name,
          url: SITE.url,
          potentialAction: { "@type": "SearchAction", target: `${SITE.url}/news?q={query}`, "query-input": "required name=query" },
        }}
      />
      <LiveUpdates since={renderedAt} />
      <section aria-labelledby="hero-title" className="home-hero relative overflow-hidden rounded-md border border-line-strong mb-8 isolate min-h-[26rem] md:min-h-[30rem] flex">
        <HeroNetwork />
        <div aria-hidden="true" className="home-hero-fade" />
        <div className="relative flex flex-col justify-end md:justify-center gap-5 p-6 pt-48 md:p-12 w-full md:max-w-[40rem]">
          <p className="font-term text-xl text-phosphor m-0">
            <span aria-hidden="true">$ </span>watch --every 1h {feedSources.length} feeds
          </p>
          <h1 id="hero-title" className="font-mono font-bold text-3xl sm:text-4xl md:text-5xl leading-[1.08] tracking-tight m-0">
            Every crypto story, once.
          </h1>
          <p className="text-muted text-lg leading-relaxed m-0 max-w-[48ch]">
            Crypto newsrooms, read every hour. When they cover the same event, you get one story with all their links.
          </p>
          <form action="/news" method="get" role="search" className="flex gap-2 max-w-md">
            <label htmlFor="hero-q" className="sr-only">Search the past month</label>
            <input id="hero-q" name="q" type="search" className="input !bg-panel/90" placeholder="ETF, Solana, hack…" />
            <button className="btn shrink-0" type="submit">Search</button>
          </form>
          <p className="font-mono text-sm text-muted m-0 cursor-blink">
            {articles24} articles in the last 24 h
            {last?.at ? ` · checked ${timeAgo(last.at)}` : last ? " · check time unavailable" : " · waiting for the first check"}
          </p>
        </div>
        <p aria-hidden="true" className="hidden lg:flex absolute right-5 bottom-4 gap-4 font-mono text-xs text-muted m-0">
          <span><span className="text-cyan">●</span> newsroom</span>
          <span><span className="text-amber">●</span> merged story</span>
        </p>
      </section>

      {!hasDatabase() && <SetupNotice />}
      <DbNotice />

      {lead && (
        <section aria-labelledby="lead-title" className="story-glass p-6 md:p-8 mb-8">
          <div className="flex flex-wrap items-center gap-3 mb-4 text-sm font-mono text-muted">
            <span className="chip text-amber border-amber/40">Top story</span>
            <Time iso={lead.lastPublishedAt} />
            {lead.sources.length > 1 && <span className="text-amber">Covered by {lead.sources.length} newsrooms</span>}
          </div>
          <h2 id="lead-title" className="font-mono font-bold text-2xl md:text-4xl leading-tight m-0 mb-4 max-w-[28ch]">
            <Link href={`/story/${lead.slug}`} className="story-title">
              {lead.title}
            </Link>
          </h2>
          {lead.summary && <p className="text-muted text-lg leading-relaxed max-w-[65ch] m-0 mb-5">{lead.summary}</p>}
          <div className="flex flex-wrap items-center gap-4">
            <Link href={`/story/${lead.slug}`} className="btn">Read the story</Link>
            <div className="flex flex-wrap gap-3 text-sm text-muted">
              {lead.sources.map((s) => <SourceGlyph key={s} source={s} />)}
            </div>
          </div>
        </section>
      )}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid gap-8 min-w-0">
          {others.length > 0 && (
            <section aria-labelledby="top-title" className="panel px-5 py-2">
              <h2 id="top-title" className="label pt-3 pb-1 m-0 text-phosphor">Also important today</h2>
              <StoryList stories={others} />
            </section>
          )}
          <section aria-labelledby="latest-title" className="panel px-5 py-2">
            <div className="flex items-center justify-between pt-3 pb-1">
              <h2 id="latest-title" className="label m-0 text-phosphor">Latest</h2>
              <Link href="/news" className="font-term text-lg text-muted">All news</Link>
            </div>
            <StoryList stories={latest.items} empty="No stories yet. The first hourly check will fill this in." />
          </section>
        </div>

        <aside className="grid gap-6 content-start" aria-label="Markets, posts and sources">
          <section aria-labelledby="mkt-title" className="panel p-5">
            <h2 id="mkt-title" className="label m-0 mb-3 text-phosphor">Markets</h2>
            {prices.length ? (
              <table className="w-full text-sm font-mono">
                <caption className="sr-only">Prices in US dollars with 24-hour change</caption>
                <tbody>
                  {prices.map((p) => (
                    <ClickableCoinRow key={p.id} href={`/market/${p.symbol}`} label={`${p.symbol} ${p.name}`} className="border-b border-line last:border-0">
                      <th scope="row" className="text-left font-semibold py-1.5"><Link href={`/market/${p.symbol}`}>{p.symbol}</Link></th>
                      <td className="text-right py-1.5">{fmtUsd(p.usd)}</td>
                      <td className={`text-right py-1.5 ${p.change24h >= 0 ? "text-up" : "text-down"}`}>{fmtPct(p.change24h)}</td>
                    </ClickableCoinRow>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-muted text-sm m-0">Prices are unavailable right now.</p>
            )}
          </section>

          <section aria-labelledby="x-title" className="panel p-5">
            <h2 id="x-title" className="label m-0 mb-3 text-phosphor">Today on X</h2>
            {posts.length ? (
              <ul className="grid gap-4 list-none p-0 m-0">
                {posts.map((p) => (
                  <li key={p.id} className="border-b border-line last:border-0 pb-3 last:pb-0">
                    <p className="font-term text-lg text-amber m-0">{p.kind === "breaking" ? "Breaking" : p.kind === "market" ? "Market update" : p.kind === "insight" ? "Trend" : "Post"}</p>
                    <p className="text-sm m-0 whitespace-pre-line">{p.content.replace(/\s*https?:\/\/\S+\s*$/, "")}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted text-sm m-0">The day&apos;s three posts are written at 06:20 UTC.</p>
            )}
            <Link href="/posts" className="inline-block mt-3 font-term text-lg text-muted">All posts</Link>
          </section>

          <section aria-labelledby="src-title" className="panel p-5">
            <h2 id="src-title" className="label m-0 mb-3 text-phosphor">Sources, last 24 h</h2>
            <ul className="grid gap-1 list-none p-0 m-0">
              {feedSources.map((f) => (
                <li key={f.id}>
                  <Link href={`/source/${f.id}`} className="flex justify-between items-center py-1 no-underline hover:text-phosphor text-sm">
                    <SourceGlyph source={f.id} />
                    <span className="font-mono text-muted">{counts[f.id] ?? 0}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="topics-title" className="panel p-5">
            <h2 id="topics-title" className="label m-0 mb-3 text-phosphor">Topics</h2>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                <Link key={k} href={`/category/${k}`} className="chip-link">{v}</Link>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}
