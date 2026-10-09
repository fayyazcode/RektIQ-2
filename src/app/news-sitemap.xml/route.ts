import { SITE } from "@/lib/config";
import { getSitemapStories } from "@/lib/data/queries";

export const dynamic = "force-dynamic";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Google News sitemap: only stories from the last 48 hours. */
export async function GET() {
  const cutoff = Date.now() - 48 * 3600_000;
  const recent = (await getSitemapStories()).filter((s) => new Date(s.lastPublishedAt).getTime() >= cutoff).slice(0, 1000);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
${recent
  .map(
    (s) => `<url><loc>${SITE.url}/story/${s.slug}</loc><news:news><news:publication><news:name>${esc(SITE.name)}</news:name><news:language>en</news:language></news:publication><news:publication_date>${s.lastPublishedAt}</news:publication_date><news:title>${esc(s.title)}</news:title></news:news></url>`
  )
  .join("\n")}
</urlset>`;
  // Let the CDN cache a good response; never cache an empty one caused by a slow database.
  const cacheControl = recent.length ? "public, s-maxage=900, stale-while-revalidate=3600" : "no-store";
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": cacheControl } });
}
