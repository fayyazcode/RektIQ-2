import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SITE } from "@/lib/config";
import { getFeedSourceCatalog } from "@/lib/feeds/registry";
import { databaseUnavailable, getRelatedStories, getStoryBySlug } from "@/lib/data/queries";
import DbNotice from "@/components/DbNotice";
import { CATEGORY_LABELS } from "@/lib/normalize/categories";
import { truncate } from "@/lib/normalize/text";
import SourceGlyph from "@/components/SourceGlyph";
import StoryList from "@/components/StoryList";
import JsonLd from "@/components/JsonLd";
import Time from "@/components/Time";
import PageHero from "@/components/PageHero";

// Rendered per request; the data itself comes from the cached queries in lib/data/queries.
// (A statically cached page could freeze a "database still connecting" render for minutes.)
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const data = await getStoryBySlug((await params).slug);
  if (!data) return { title: databaseUnavailable() ? "Loading story" : "Story not found", robots: { index: false } };
  const { story } = data;
  const description = truncate(story.aiSummary?.whatHappened || story.summary || story.title, 158);
  return {
    title: story.title,
    description,
    alternates: { canonical: `/story/${story.slug}` },
    openGraph: { type: "article", url: `/story/${story.slug}`, title: story.title, description, publishedTime: story.firstPublishedAt, modifiedTime: story.lastPublishedAt },
    twitter: { card: "summary_large_image", title: story.title, description },
  };
}

export default async function StoryPage({ params }: Props) {
  const data = await getStoryBySlug((await params).slug);
  if (!data) {
    // A slow database shouldn't turn a real story into a 404
    if (databaseUnavailable()) return <DbNotice />;
    notFound();
  }
  const { story, articles } = data;
  const sourceById = new Map((await getFeedSourceCatalog()).map((feed) => [feed.id, feed]));
  const related = await getRelatedStories(story.id, story.categories);

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <JsonLd
        data={[
          {
            "@context": "https://schema.org",
            "@type": "NewsArticle",
            headline: truncate(story.title, 110),
            description: story.aiSummary?.whatHappened ?? story.summary,
            datePublished: story.firstPublishedAt,
            dateModified: story.lastPublishedAt,
            mainEntityOfPage: `${SITE.url}/story/${story.slug}`,
            isBasedOn: articles.map((a) => a.url),
            publisher: { "@type": "Organization", name: SITE.name, url: SITE.url },
            author: story.sources.map((s) => ({ "@type": "Organization", name: sourceById.get(s)?.name ?? s, url: sourceById.get(s)?.homepage })),
            keywords: [...story.categories.map((c) => CATEGORY_LABELS[c]), ...story.coins].join(", "),
          },
          {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "News", item: `${SITE.url}/news` },
              ...(story.categories[0]
                ? [{ "@type": "ListItem", position: 2, name: CATEGORY_LABELS[story.categories[0]], item: `${SITE.url}/category/${story.categories[0]}` }]
                : []),
              { "@type": "ListItem", position: story.categories[0] ? 3 : 2, name: story.title },
            ],
          },
        ]}
      />
      <article className="story-reading min-w-0">
        <nav aria-label="Breadcrumb" className="font-term text-lg text-muted mb-4">
          <ol className="flex flex-wrap gap-2 list-none p-0 m-0">
            <li><Link href="/news">News</Link></li>
            {story.categories[0] && (
              <li>
                <span aria-hidden="true">/ </span>
                <Link href={`/category/${story.categories[0]}`}>{CATEGORY_LABELS[story.categories[0]]}</Link>
              </li>
            )}
          </ol>
        </nav>
        <PageHero variant="story" kicker={<>THE STORY · {story.sources.length} source{story.sources.length === 1 ? "" : "s"}</>} title={story.title}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm font-mono text-muted">
          <span>First reported <Time iso={story.firstPublishedAt} /></span>
          {story.lastPublishedAt !== story.firstPublishedAt && <span>Updated <Time iso={story.lastPublishedAt} /></span>}
        </div>
        </PageHero>
        {story.aiSummary ? (
          <section aria-labelledby="summary-title" className="story-glass p-5 md:p-7 mb-6">
            <h2 id="summary-title" className="label m-0 mb-3 text-phosphor">The story so far</h2>
            <p className="text-lg leading-relaxed max-w-[65ch] m-0 mb-4">{story.aiSummary.whatHappened}</p>
            {story.aiSummary.keyFacts.length > 0 && (
              <>
                <h3 className="font-term text-lg text-amber m-0 mb-1">Key facts</h3>
                <ul className="m-0 mb-4 pl-5 grid gap-1 max-w-[65ch] list-disc marker:text-phosphor">
                  {story.aiSummary.keyFacts.map((f) => <li key={f}>{f}</li>)}
                </ul>
              </>
            )}
            <h3 className="font-term text-lg text-amber m-0 mb-1">Why it matters</h3>
            <p className="m-0 mb-4 max-w-[65ch] text-muted">{story.aiSummary.whyItMatters}</p>
            <p className="m-0 text-xs text-dim">
              Summary written by AI from {story.aiSummary.sourceCount} newsroom{story.aiSummary.sourceCount > 1 ? "s'" : "'s"} reporting, checked so
              every figure appears in the sources. Updated <Time iso={story.aiSummary.at} />. Read the original reporting below.
            </p>
          </section>
        ) : (
          story.summary && <p className="text-lg leading-relaxed max-w-[65ch] m-0 mb-8">{story.summary}</p>
        )}

        <section aria-labelledby="coverage" className="story-glass p-5 md:p-7 mb-6">
          <h2 id="coverage" className="label m-0 mb-1 text-phosphor">
            {articles.length > 1 ? `Coverage from ${story.sources.length} newsroom${story.sources.length > 1 ? "s" : ""}` : "Original reporting"}
          </h2>
          <p className="text-sm text-muted m-0 mb-4">Read the full story at the source.</p>
          <ol className="grid gap-4 list-none p-0 m-0">
            {articles.map((a) => (
              <li key={a.id} className="border-t border-line pt-4 first:border-0 first:pt-0">
                <div className="flex flex-wrap items-center gap-3 text-sm text-muted mb-1">
                  <SourceGlyph source={a.source} />
                  <Time iso={a.publishedAt} />
                  {a.author && <span>by {a.author}</span>}
                  {a.version > 1 && <span className="text-amber" title="The publisher edited this headline or summary">edited</span>}
                </div>
                <a href={a.url} target="_blank" rel="noopener" className="font-mono font-semibold text-ink hover:text-phosphor">
                  {a.title} <span aria-hidden="true">↗</span>
                  <span className="sr-only"> (opens {sourceById.get(a.source)?.name ?? a.source} in a new tab)</span>
                </a>
                {a.summary && a.summary !== story.summary && <p className="text-sm text-muted m-0 mt-1 max-w-[65ch]">{a.summary}</p>}
              </li>
            ))}
          </ol>
        </section>

        {(story.categories.length > 0 || story.coins.length > 0) && (
          <div className="flex flex-wrap gap-1.5" aria-label="Topics and coins">
            {story.categories.map((c) => <Link key={c} href={`/category/${c}`} className="chip-link">{CATEGORY_LABELS[c]}</Link>)}
            {story.coins.map((c) => <Link key={c} href={`/news?coin=${c}`} className="chip-link">{c}</Link>)}
          </div>
        )}
      </article>
      <aside aria-labelledby="related-title" className="panel px-5 py-2 content-start h-fit">
        <h2 id="related-title" className="label pt-3 m-0 text-phosphor">Related</h2>
        <StoryList stories={related} empty="Nothing related this week." />
      </aside>
    </div>
  );
}
