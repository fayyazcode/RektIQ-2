import type { MetadataRoute } from "next";
import { SITE } from "@/lib/config";
import { getFeedSources } from "@/lib/feeds/registry";
import { ALL_CATEGORIES } from "@/lib/normalize/categories";
import { getSitemapStories } from "@/lib/data/queries";

// Rendered per request; the data itself comes from the cached queries in lib/data/queries.
// (A statically cached page could freeze a "database still connecting" render for minutes.)
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [stories, feedSources] = await Promise.all([getSitemapStories(), getFeedSources()]);
  return [
    { url: SITE.url, changeFrequency: "hourly", priority: 1 },
    { url: `${SITE.url}/news`, changeFrequency: "hourly", priority: 0.9 },
    { url: `${SITE.url}/posts`, changeFrequency: "daily", priority: 0.6 },
    { url: `${SITE.url}/sources`, changeFrequency: "monthly", priority: 0.3 },
    { url: `${SITE.url}/about`, changeFrequency: "yearly", priority: 0.3 },
    ...feedSources.map((f) => ({ url: `${SITE.url}/source/${f.id}`, changeFrequency: "hourly" as const, priority: 0.6 })),
    ...ALL_CATEGORIES.map((c) => ({ url: `${SITE.url}/category/${c}`, changeFrequency: "hourly" as const, priority: 0.6 })),
    ...stories.map((s) => ({ url: `${SITE.url}/story/${s.slug}`, lastModified: s.lastPublishedAt, changeFrequency: "weekly" as const, priority: 0.7 })),
  ];
}
