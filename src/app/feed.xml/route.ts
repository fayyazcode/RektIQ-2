import { SITE } from "@/lib/config";
import { getStories } from "@/lib/data/queries";

export const dynamic = "force-dynamic";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export async function GET() {
  const { items } = await getStories({ perPage: 50 });
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>${esc(SITE.name)}</title>
<link>${SITE.url}</link>
<description>${esc(SITE.description)}</description>
<language>en</language>
<atom:link href="${SITE.url}/feed.xml" rel="self" type="application/rss+xml"/>
${items
  .map(
    (s) => `<item><title>${esc(s.title)}</title><link>${SITE.url}/story/${s.slug}</link><guid isPermaLink="true">${SITE.url}/story/${s.slug}</guid><pubDate>${new Date(s.lastPublishedAt).toUTCString()}</pubDate>${s.categories.map((c) => `<category>${c}</category>`).join("")}<description>${esc(s.summary)}</description></item>`
  )
  .join("\n")}
</channel>
</rss>`;
  // Let the CDN cache a good response; never cache an empty one caused by a slow database.
  const cacheControl = items.length ? "public, s-maxage=900, stale-while-revalidate=3600" : "no-store";
  return new Response(xml, { headers: { "Content-Type": "application/rss+xml; charset=utf-8", "Cache-Control": cacheControl } });
}
