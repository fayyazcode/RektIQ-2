import PageHero from "@/components/PageHero";
import type { Metadata } from "next";
import { getFeedSources } from "@/lib/feeds/registry";
import { ALL_CATEGORIES, CATEGORY_LABELS } from "@/lib/normalize/categories";
import { getStories, RANGES, type StoryRange } from "@/lib/data/queries";
import { RETENTION_DAYS } from "@/lib/config";
import LiveUpdates from "@/components/LiveUpdates";
import DbNotice from "@/components/DbNotice";
import StoryList from "@/components/StoryList";
import Pagination from "@/components/Pagination";
import type { Category } from "@/lib/types";

type SP = Promise<{ q?: string; category?: string; source?: string; coin?: string; range?: string; page?: string }>;

export async function generateMetadata({ searchParams }: { searchParams: SP }): Promise<Metadata> {
  const sp = await searchParams;
  const filtered = Boolean(sp.q || sp.category || sp.source || sp.coin || sp.range || (sp.page && sp.page !== "1"));
  return {
    title: sp.q ? `Search: ${sp.q}` : "All crypto news",
    description: "Every story from the tracked crypto news feeds, with duplicate coverage merged. Filter by topic, source or coin.",
    alternates: { canonical: "/news" },
    robots: filtered ? { index: false, follow: true } : undefined,
  };
}

const COINS = ["BTC", "ETH", "SOL", "XRP", "BNB", "DOGE", "ADA", "USDT", "USDC", "LINK", "TON", "AVAX"];

export default async function NewsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const feedSources = await getFeedSources();
  const category = ALL_CATEGORIES.includes(sp.category as Category) ? (sp.category as Category) : undefined;
  const source = feedSources.some((f) => f.id === sp.source) ? sp.source : undefined;
  const coin = sp.coin && COINS.includes(sp.coin.toUpperCase()) ? sp.coin.toUpperCase() : undefined;
  const q = sp.q?.slice(0, 100);
  const range = RANGES.some((r) => r.id === sp.range) ? (sp.range as StoryRange) : undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const result = await getStories({ category, source, coin, q, range, page });
  const renderedAt = new Date().toISOString();

  const href = (p: number) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (category) params.set("category", category);
    if (source) params.set("source", source);
    if (coin) params.set("coin", coin);
    if (range) params.set("range", range);
    if (p > 1) params.set("page", String(p));
    const s = params.toString();
    return `/news${s ? `?${s}` : ""}`;
  };

  return (
    <>
      {page === 1 && !q && <LiveUpdates since={renderedAt} />}
      <DbNotice />
      <PageHero variant="news" kicker={<><span aria-hidden="true">$ </span>grep --past {RETENTION_DAYS}d</>} title={q ? `Results for “${q}”` : "All news"}>
        {result.total} {result.total === 1 ? "story" : "stories"}. Search covers the past {RETENTION_DAYS} days. When several newsrooms cover the
        same event, it appears once.
      </PageHero>

      <form method="get" action="/news" role="search" className="panel p-4 mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] items-end">
        <label className="grid gap-1">
          <span className="label">Search</span>
          <input className="input" type="search" name="q" defaultValue={q} placeholder="ETF, Solana, hack…" />
        </label>
        <label className="grid gap-1">
          <span className="label">Topic</span>
          <select className="input" name="category" defaultValue={category ?? ""}>
            <option value="">All topics</option>
            {ALL_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="label">Source</span>
          <select className="input" name="source" defaultValue={source ?? ""}>
            <option value="">All sources</option>
            {feedSources.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="label">Coin</span>
          <select className="input" name="coin" defaultValue={coin ?? ""}>
            <option value="">All coins</option>
            {COINS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="label">When</span>
          <select className="input" name="range" defaultValue={range ?? "30d"}>
            {RANGES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </label>
        <button type="submit" className="btn">Search</button>
      </form>

      <section className="panel px-5 py-2" aria-label="Stories">
        <StoryList stories={result.items} empty="No stories match these filters. Try removing one." />
      </section>
      <Pagination page={result.page} pages={result.pages} makeHref={href} />
    </>
  );
}
