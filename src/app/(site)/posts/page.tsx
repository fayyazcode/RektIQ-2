import PageHero from "@/components/PageHero";
import DbNotice from "@/components/DbNotice";
import type { Metadata } from "next";
import Link from "next/link";
import { getPublicPosts } from "@/lib/data/queries";
import { fmtDate } from "@/lib/format";
import Time from "@/components/Time";
import type { PostView } from "@/lib/types";

// Rendered per request; the data itself comes from the cached queries in lib/data/queries.
// (A statically cached page could freeze a "database still connecting" render for minutes.)
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Daily posts on X",
  description: "The three crypto stories posted to X each day: the most important development, a market update, and the trend behind them.",
  alternates: { canonical: "/posts" },
};

const LABEL = { breaking: "Breaking", market: "Market update", insight: "Trend", other: "Post" } as const;

export default async function PostsPage() {
  const posts = await getPublicPosts(90);
  const days = new Map<string, PostView[]>();
  for (const p of posts) {
    const d = p.scheduledAt.slice(0, 10);
    days.set(d, [...(days.get(d) ?? []), p]);
  }
  return (
    <>
      <DbNotice />
      <PageHero variant="posts" kicker={<><span aria-hidden="true">$ </span>cat posts.log</>} title="Posts on X">
        Each morning the day&apos;s best-covered stories are shortlisted and three posts are written: the most important development, a market
        update and a trend.
      </PageHero>
      {posts.length === 0 && <p className="panel p-5 text-muted">No posts have been scheduled yet.</p>}
      <div className="grid gap-6">
        {[...days.entries()].map(([day, list]) => (
          <section key={day} className="panel p-5" aria-label={fmtDate(`${day}T12:00:00Z`)}>
            <h2 className="label m-0 mb-4 text-phosphor">{fmtDate(`${day}T12:00:00Z`)}</h2>
            <ul className="grid gap-4 list-none p-0 m-0">
              {[...list].reverse().map((p) => (
                <li key={p.id} className="border-t border-line pt-4 first:border-0 first:pt-0">
                  <p className="m-0 mb-1 font-term text-lg text-amber">
                    {p.origin === "breaking" ? "Breaking alert" : LABEL[p.kind]} <span className="text-muted">· <Time iso={p.scheduledAt} mode="time" /></span>
                  </p>
                  <p className="m-0 whitespace-pre-line max-w-[65ch]">{p.content.replace(/\s*https?:\/\/\S+\s*$/, "")}</p>
                  <div className="flex gap-4 text-sm">
                    {p.storySlug && <Link href={`/story/${p.storySlug}`} className="text-muted">Read the story</Link>}
                    {p.externalUrl && <a href={p.externalUrl} target="_blank" rel="noopener" className="text-phosphor">View on X ↗</a>}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}
