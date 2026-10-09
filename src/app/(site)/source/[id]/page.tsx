import PageHero from "@/components/PageHero";
import DbNotice from "@/components/DbNotice";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFeedSourceById } from "@/lib/feeds/registry";
import { getFeedSources } from "@/lib/feeds/registry";
import { getStories } from "@/lib/data/queries";
import StoryList from "@/components/StoryList";
import Pagination from "@/components/Pagination";

// Rendered per request; the data itself comes from the cached queries in lib/data/queries.
// (A statically cached page could freeze a "database still connecting" render for minutes.)
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ page?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const f = await getFeedSourceById((await params).id);
  if (!f) return {};
  return { title: `${f.name} news today`, description: `Latest ${f.name} crypto stories, checked every hour. ${f.blurb}`, alternates: { canonical: `/source/${f.id}` } };
}

export default async function SourcePage({ params, searchParams }: Props) {
  const id = (await params).id;
  const [f, activeFeeds] = await Promise.all([getFeedSourceById(id), getFeedSources()]);
  if (!f) notFound();
  const active = activeFeeds.some((feed) => feed.id === id);
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const result = await getStories({ source: f.id, page });
  return (
    <>
      <DbNotice />
      <PageHero variant="source" kicker={<><span aria-hidden="true">$ </span>tail {f.id}.rss</>} title={f.name}>
        {f.blurb} <a href={f.homepage} target="_blank" rel="noopener" className="text-phosphor">Visit {f.name}</a>
      </PageHero>
      {!active && <p className="panel p-4 text-sm text-muted">This feed is no longer monitored. Stories collected earlier remain available below.</p>}
      <section className="panel px-5 py-2"><StoryList stories={result.items} /></section>
      <Pagination page={result.page} pages={result.pages} makeHref={(p) => `/source/${f.id}${p > 1 ? `?page=${p}` : ""}`} />
    </>
  );
}
