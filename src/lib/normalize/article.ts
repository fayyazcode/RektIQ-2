import type { FeedSource } from "../config";
import type { NormalizedArticle } from "../types";
import { canonicalizeUrl, sha1 } from "./url";
import { cleanSummary, cleanText, cleanTitle, stripHtml, titleKey } from "./text";
import { categorize, detectCoins } from "./categories";
import { tokenize } from "../dedupe/similarity";

export type RawItem = {
  title?: string;
  link?: string;
  guid?: string;
  id?: string;
  isoDate?: string;
  pubDate?: string;
  creator?: string;
  author?: string;
  "dc:creator"?: string;
  content?: string;
  contentSnippet?: string;
  summary?: string;
  description?: string;
  "content:encoded"?: string;
  categories?: unknown[];
  enclosure?: { url?: string; type?: string };
  "media:content"?: { $?: { url?: string } } | { $?: { url?: string } }[];
  "media:thumbnail"?: { $?: { url?: string } };
};

export type RejectReason = "missing_title" | "bad_url" | "too_old" | "too_short";

const MAX_AGE_DAYS = 7;
const FUTURE_TOLERANCE_MS = 60 * 60 * 1000;

function parseDate(item: RawItem, now: Date): Date {
  for (const v of [item.isoDate, item.pubDate]) {
    if (!v) continue;
    const d = new Date(v);
    if (!isNaN(d.getTime())) {
      // Feeds occasionally publish future timestamps (wrong timezone); clamp to "now".
      return d.getTime() > now.getTime() + FUTURE_TOLERANCE_MS ? now : d;
    }
  }
  return now;
}

function tagText(c: unknown): string {
  if (typeof c === "string") return c;
  if (c && typeof c === "object" && "_" in c) return String((c as { _: unknown })._);
  return "";
}

function pickImage(item: RawItem): string | null {
  const media = Array.isArray(item["media:content"]) ? item["media:content"][0] : item["media:content"];
  const html = item["content:encoded"] || item.content || "";
  const candidate =
    (item.enclosure?.type?.startsWith("image") || !item.enclosure?.type ? item.enclosure?.url : undefined) ||
    media?.$?.url ||
    item["media:thumbnail"]?.$?.url ||
    html.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1];
  const canonical = candidate ? canonicalizeUrl(candidate) : null;
  return canonical;
}

export function normalizeItem(
  item: RawItem,
  feed: FeedSource,
  now = new Date()
): { ok: true; article: NormalizedArticle } | { ok: false; reason: RejectReason } {
  const title = cleanTitle(item.title || "", feed.name);
  if (title.length < 8) return { ok: false, reason: title ? "too_short" : "missing_title" };

  const canonicalUrl = item.link ? canonicalizeUrl(item.link) : null;
  if (!canonicalUrl) return { ok: false, reason: "bad_url" };

  const publishedAt = parseDate(item, now);
  if (now.getTime() - publishedAt.getTime() > MAX_AGE_DAYS * 86400_000) return { ok: false, reason: "too_old" };

  const summary = cleanSummary(
    item.contentSnippet || item.summary || item.description || item["content:encoded"] || item.content || ""
  );
  const rawCategories = [...new Set((item.categories || []).map(tagText).map((t) => cleanText(stripHtml(t))).filter(Boolean))].slice(0, 12);
  const authorRaw = item.creator || item["dc:creator"] || item.author || "";
  const author = cleanText(stripHtml(authorRaw)).replace(/^by\s+/i, "") || null;
  const key = titleKey(title);

  return {
    ok: true,
    article: {
      source: feed.id,
      guid: cleanText(String(item.guid || item.id || canonicalUrl)),
      url: item.link!.trim(),
      canonicalUrl,
      urlHash: sha1(canonicalUrl),
      title,
      titleKey: key,
      titleHash: sha1(key),
      summary,
      contentHash: sha1(`${key}\n${summary}`),
      author: author && author.length <= 120 ? author : null,
      publishedAt,
      categories: categorize(title, summary, rawCategories),
      coins: detectCoins(`${title} ${summary}`),
      rawCategories,
      image: pickImage(item),
      titleTokens: tokenize(title),
      tokens: tokenize(`${title} ${summary}`).slice(0, 60),
    },
  };
}
