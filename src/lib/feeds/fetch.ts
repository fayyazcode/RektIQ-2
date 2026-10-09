import Parser from "rss-parser";
import type { FeedSource } from "../config";
import type { RawItem } from "../normalize/article";

const parser = new Parser<Record<string, unknown>, RawItem>({
  customFields: {
    item: ["content:encoded", "media:content", "media:thumbnail", "description", "dc:creator"],
  },
});

const UA = "RektoIQBot/2.0 (+https://rektoiq.vercel.app; hourly RSS reader)";
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
const MAX_BYTES = 5 * 1024 * 1024;

export type FetchFeedResult =
  | { status: "ok"; httpStatus: number; items: RawItem[]; etag: string | null; lastModified: string | null; ms: number }
  | { status: "not_modified"; httpStatus: 304; ms: number }
  | { status: "error"; httpStatus: number | null; error: string; ms: number };

/**
 * Conditional GET: sends the ETag / Last-Modified from the previous hour, so an
 * unchanged feed costs one 304 response and no parsing.
 */
export async function fetchFeed(
  feed: FeedSource,
  prev: { etag: string | null; lastModified: string | null } | null
): Promise<FetchFeedResult> {
  const started = Date.now();
  const headers: Record<string, string> = {
    "User-Agent": UA,
    Accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5",
  };
  if (prev?.etag) headers["If-None-Match"] = prev.etag;
  if (prev?.lastModified) headers["If-Modified-Since"] = prev.lastModified;

  let lastError = "unknown error";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(feed.url, { headers, redirect: "follow", signal: AbortSignal.timeout(15_000) });
      if (res.status === 304) return { status: "not_modified", httpStatus: 304, ms: Date.now() - started };
      if (res.status === 403 && attempt === 0) {
        // Some CDNs block unknown bots; retry once looking like a regular browser.
        lastError = "HTTP 403";
        headers["User-Agent"] = BROWSER_UA;
        continue;
      }
      if (!res.ok) {
        lastError = `HTTP ${res.status}`;
        if (res.status >= 500 || res.status === 429) {
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
        return { status: "error", httpStatus: res.status, error: lastError, ms: Date.now() - started };
      }
      const len = Number(res.headers.get("content-length") || 0);
      if (len > MAX_BYTES) return { status: "error", httpStatus: res.status, error: "Feed too large", ms: Date.now() - started };
      const xml = await res.text();
      if (xml.length > MAX_BYTES) return { status: "error", httpStatus: res.status, error: "Feed too large", ms: Date.now() - started };
      const parsed = await parser.parseString(xml);
      return {
        status: "ok",
        httpStatus: res.status,
        items: parsed.items ?? [],
        etag: res.headers.get("etag"),
        lastModified: res.headers.get("last-modified"),
        ms: Date.now() - started,
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt === 0) await new Promise((r) => setTimeout(r, 1500));
    }
  }
  return { status: "error", httpStatus: null, error: lastError, ms: Date.now() - started };
}
