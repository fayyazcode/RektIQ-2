import { ImageResponse } from "next/og";
import { SITE } from "@/lib/config";
import { getStoryBySlug } from "@/lib/data/queries";
import { getFeedSourceCatalog } from "@/lib/feeds/registry";

export const alt = "Story";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function StoryOg({ params }: { params: Promise<{ slug: string }> }) {
  const data = await getStoryBySlug((await params).slug);
  const title = data?.story.title ?? SITE.name;
  const sourceById = new Map((await getFeedSourceCatalog()).map((feed) => [feed.id, feed]));
  const sources = data?.story.sources.map((s) => sourceById.get(s)?.name ?? s).join(" · ") ?? "";
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#000", padding: 72, border: "8px solid #22863a" }}>
        <div style={{ fontSize: 34, color: "#4ade80", fontWeight: 700 }}>{SITE.name}</div>
        <div style={{ fontSize: title.length > 90 ? 52 : 66, color: "#dfeadf", fontWeight: 800, lineHeight: 1.1 }}>{title}</div>
        <div style={{ fontSize: 28, color: "#f5b041" }}>{sources}</div>
      </div>
    ),
    size
  );
}
