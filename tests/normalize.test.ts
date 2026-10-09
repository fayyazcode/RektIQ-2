import { describe, expect, it } from "vitest";
import { canonicalizeUrl } from "@/lib/normalize/url";
import { cleanSummary, cleanTitle, titleKey } from "@/lib/normalize/text";
import { categorize, detectCoins } from "@/lib/normalize/categories";
import { normalizeItem } from "@/lib/normalize/article";
import { FEEDS } from "@/lib/config";

describe("canonicalizeUrl", () => {
  it("strips tracking, www, fragments, trailing slash and amp", () => {
    expect(canonicalizeUrl("http://www.CoinDesk.com/markets/2026/09/22/btc/?utm_source=rss&utm_medium=feed#top")).toBe(
      "https://coindesk.com/markets/2026/09/22/btc"
    );
    expect(canonicalizeUrl("https://decrypt.co/1234/story/amp")).toBe("https://decrypt.co/1234/story");
  });
  it("keeps meaningful query params, sorted", () => {
    expect(canonicalizeUrl("https://x.com/a?b=2&a=1&fbclid=zzz")).toBe("https://x.com/a?a=1&b=2");
  });
  it("rejects non-http urls", () => {
    expect(canonicalizeUrl("javascript:alert(1)")).toBeNull();
    expect(canonicalizeUrl("not a url")).toBeNull();
  });
});

describe("text cleanup", () => {
  it("removes feed boilerplate and html", () => {
    expect(cleanSummary("<p>Bitcoin rose &amp; held.</p> The post Bitcoin rises appeared first on Cointelegraph.")).toBe("Bitcoin rose & held.");
  });
  it("removes source suffix and 'Breaking:' prefix from titles", () => {
    expect(cleanTitle("BREAKING: SEC approves ETF - CoinDesk", "CoinDesk")).toBe("SEC approves ETF");
  });
  it("builds stable title keys", () => {
    expect(titleKey("Bitcoin’s  Price: “Record”!")).toBe(titleKey("bitcoin's price record"));
  });
});

describe("taxonomy", () => {
  it("maps headlines to canonical categories and tickers", () => {
    const cats = categorize("SEC approves spot Solana ETF as SOL rallies", "", ["Markets News"]);
    expect(cats).toEqual(expect.arrayContaining(["etf", "regulation", "altcoins", "markets"]));
    expect(detectCoins("Bitcoin and Ether slide; Tether mints $1B USDT")).toEqual(["BTC", "ETH", "USDT"]);
  });
});

describe("normalizeItem", () => {
  const feed = FEEDS[1];
  const now = new Date("2026-09-22T12:00:00Z");
  it("normalizes a typical RSS item", () => {
    const r = normalizeItem(
      { title: "Bitcoin Tops $118K - CoinDesk", link: "https://www.coindesk.com/x/?utm_source=rss", isoDate: "2026-09-22T10:00:00Z", contentSnippet: "Spot ETF inflows hit $900 million.", categories: ["Markets"] },
      feed,
      now
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.article.title).toBe("Bitcoin Tops $118K");
    expect(r.article.canonicalUrl).toBe("https://coindesk.com/x");
    expect(r.article.coins).toContain("BTC");
    expect(r.article.titleTokens).toContain("118k");
  });
  it("clamps future dates and rejects stale or broken items", () => {
    const future = normalizeItem({ title: "A valid headline here", link: "https://a.com/1", isoDate: "2026-09-25T00:00:00Z" }, feed, now);
    expect(future.ok && future.article.publishedAt.toISOString()).toBe(now.toISOString());
    expect(normalizeItem({ title: "Old news headline", link: "https://a.com/2", isoDate: "2026-08-01T00:00:00Z" }, feed, now)).toEqual({ ok: false, reason: "too_old" });
    expect(normalizeItem({ title: "No link on this one", link: "" }, feed, now)).toEqual({ ok: false, reason: "bad_url" });
  });
});

import { hashPassword, verifyPassword } from "@/lib/auth/password";
describe("password hashing", () => {
  it("round-trips and uses a .env-safe format", async () => {
    const h = await hashPassword("correct horse battery");
    expect(h).not.toContain("$");
    expect(await verifyPassword("correct horse battery", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
    expect(await verifyPassword("correct horse battery", `'${h}'`)).toBe(true);
  });
});

import { cleanValue } from "@/lib/env";
describe("environment values", () => {
  it("removes quotes, spaces and invisible characters that .env files would strip", () => {
    expect(cleanValue('"abc123"')).toBe("abc123");
    expect(cleanValue("  'abc123'\n")).toBe("abc123");
    expect(cleanValue("\uFEFFabc123")).toBe("abc123");
    expect(cleanValue('""')).toBeUndefined();
    expect(cleanValue("a\"b")).toBe("a\"b");
  });
});
