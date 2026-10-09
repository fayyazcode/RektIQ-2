import { config } from "./env";
import type { FeedSource } from "./types";

export type { FeedSource } from "./types";

export const FEEDS: FeedSource[] = [
  { id: "bitcoin-magazine", name: "Bitcoin Magazine", url: "https://bitcoinmagazine.com/feed", homepage: "https://bitcoinmagazine.com", glyph: "₿", blurb: "Bitcoin news, markets, technical and policy coverage." },
  { id: "coindesk", name: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/", homepage: "https://www.coindesk.com", glyph: "◈", blurb: "Markets, policy and industry reporting." },
  { id: "cointelegraph", name: "Cointelegraph", url: "https://cointelegraph.com/rss", homepage: "https://cointelegraph.com", glyph: "⬡", blurb: "Fast-moving news across Bitcoin, Ethereum and DeFi." },
  { id: "decrypt", name: "Decrypt", url: "https://decrypt.co/feed", homepage: "https://decrypt.co", glyph: "◉", blurb: "Crypto, Web3 and AI news for a wide audience." },
  { id: "the-block", name: "The Block", url: "https://www.theblock.co/rss.xml", homepage: "https://www.theblock.co", glyph: "◆", blurb: "Research-driven news on markets and infrastructure." },
];

export const feedById = (id: string) => FEEDS.find((f) => f.id === id);

export const SITE = {
  name: process.env.NEXT_PUBLIC_SITE_NAME || "RecktIQ",
  tagline: "Crypto news from trusted newsrooms, checked every hour, duplicates merged.",
  description:
    "RecktIQ combines crypto news, market data, and social sentiment to surface important developments.",
  url: (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, ""),
  xHandle: process.env.NEXT_PUBLIC_X_HANDLE || "",
};

/** How far back the hourly job looks for stories a new article could belong to. */
export const CLUSTER_WINDOW_HOURS = 48;

/**
 * How long news, runs and posts are kept. Readers can search this window;
 * the daily cleanup job deletes anything older. Override with RETENTION_DAYS.
 */
export const RETENTION_DAYS = Math.min(365, Math.max(7, Number(config("RETENTION_DAYS")) || 30));
export const retentionCutoff = (now = new Date()) => new Date(now.getTime() - RETENTION_DAYS * 86400_000);
