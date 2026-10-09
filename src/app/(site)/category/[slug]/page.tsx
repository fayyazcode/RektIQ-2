import PageHero from "@/components/PageHero";
import DbNotice from "@/components/DbNotice";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ALL_CATEGORIES, CATEGORY_LABELS } from "@/lib/normalize/categories";
import { getStories } from "@/lib/data/queries";
import StoryList from "@/components/StoryList";
import Pagination from "@/components/Pagination";
import type { Category } from "@/lib/types";

// Rendered per request; the data itself comes from the cached queries in lib/data/queries.
// (A statically cached page could freeze a "database still connecting" render for minutes.)
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ page?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const slug = (await params).slug as Category;
  if (!ALL_CATEGORIES.includes(slug)) return {};
  const label = CATEGORY_LABELS[slug];
  return { title: `${label} news`, description: `The latest ${label} news from five crypto newsrooms, with duplicate coverage merged.`, alternates: { canonical: `/category/${slug}` } };
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const slug = (await params).slug as Category;
  if (!ALL_CATEGORIES.includes(slug)) notFound();
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const result = await getStories({ category: slug, page });
  return (
    <>
      <DbNotice />
      <PageHero variant="category" kicker={<><span aria-hidden="true">$ </span>tag {slug}</>} title={`${CATEGORY_LABELS[slug]} news`}>
        {result.total} {result.total === 1 ? "story" : "stories"} in the past month.
      </PageHero>
      <section className="panel px-5 py-2"><StoryList stories={result.items} /></section>
      <Pagination page={result.page} pages={result.pages} makeHref={(p) => `/category/${slug}${p > 1 ? `?page=${p}` : ""}`} />
    </>
  );
}
