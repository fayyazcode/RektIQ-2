import PageHero from "@/components/PageHero";
import type { Metadata } from "next";
import { SITE } from "@/lib/config";

export const metadata: Metadata = { title: "About", description: `How ${SITE.name} collects crypto news and writes its daily posts.`, alternates: { canonical: "/about" } };

export default function AboutPage() {
  return (
    <article>
      <PageHero variant="about" kicker={<><span aria-hidden="true">$ </span>man {SITE.name.toLowerCase()}</>} title={`About ${SITE.name}`} />
      <div className="max-w-[68ch]">
      <h2 className="font-mono text-xl mt-8 mb-2">How an hour works</h2>
      <ol className="text-muted grid gap-2 pl-5">
        <li>The five source feeds are checked. Feeds that haven&apos;t changed since the last hour are skipped.</li>
        <li>Each item is cleaned up: tracking links removed, publisher boilerplate stripped, times converted to UTC, topics and coins tagged.</li>
        <li>Items we&apos;ve already seen are ignored; ones the publisher edited are updated.</li>
        <li>New items are compared with the last two days of stories. If another newsroom already covered the same event, the new item joins that story instead of appearing twice.</li>
      </ol>
      <h2 className="font-mono text-xl mt-8 mb-2">How posts are chosen</h2>
      <p className="text-muted">
        Stories are ranked by how many newsrooms covered them, how recent they are, and what they&apos;re about. An AI model picks three from the top
        ten and writes one post each, using only facts from the headlines and summaries.
      </p>
      <h2 className="font-mono text-xl mt-8 mb-2">What we don&apos;t do</h2>
      <p className="text-muted">We don&apos;t republish articles or write our own reporting. Nothing here is investment advice.</p>
      </div>
    </article>
  );
}
