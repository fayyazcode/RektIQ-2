import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import { getPrices } from "@/lib/prices";
import { SITE } from "@/lib/config";

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const prices = await getPrices();
  return (
    <>
      <SiteHeader prices={prices} />
      <main id="main" className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
        {children}
      </main>
      <footer className="border-t border-line mt-12 no-print">
        <div className="mx-auto max-w-6xl px-4 py-8 flex flex-wrap justify-between gap-6 text-sm text-muted">
          <p className="m-0 max-w-[60ch]">
            Headlines and summaries come from each publisher&apos;s public RSS feed and link to the original reporting. Prices from CoinGecko.
            Nothing on {SITE.name} is financial advice.
          </p>
          <nav aria-label="Footer" className="flex flex-wrap gap-4 font-term text-lg">
            <Link href="/news">All news</Link>
            <Link href="/sources">Sources</Link>
            <Link href="/posts">X posts</Link>
            <Link href="/about">About</Link>
            <a href="/feed.xml">RSS</a>
          </nav>
        </div>
      </footer>
    </>
  );
}
