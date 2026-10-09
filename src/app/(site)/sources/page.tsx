import PageHero from "@/components/PageHero";
import type { Metadata } from "next";
import Link from "next/link";
import { getFeedSources } from "@/lib/feeds/registry";
import SourceGlyph from "@/components/SourceGlyph";

export const metadata: Metadata = {
  title: "Sources",
  description: "RecktIQ reads tracked crypto publisher feeds every hour.",
  alternates: { canonical: "/sources" },
};

export const dynamic = "force-dynamic";

export default async function SourcesPage() {
  const feedSources = await getFeedSources();
  return (
    <>
      <PageHero variant="sources" kicker={<><span aria-hidden="true">$ </span>ls feeds/</>} title="Sources">
        Every hour we read these public feeds. Each story links back to the publisher.
      </PageHero>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {feedSources.map((f) => (
          <section key={f.id} className="panel p-5 grid gap-3 content-start">
            <h2 className="m-0 text-lg font-mono"><SourceGlyph source={f.id} /></h2>
            <p className="m-0 text-muted text-sm">{f.blurb}</p>
            <div className="flex gap-3 items-center">
              <Link href={`/source/${f.id}`} className="btn btn-ghost">See stories</Link>
              <a href={f.homepage} target="_blank" rel="noopener" className="font-term text-lg text-muted">Visit site</a>
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
