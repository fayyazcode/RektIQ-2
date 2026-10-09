import { secret } from "./env";
export type Price = { id: string; symbol: string; name: string; usd: number; change24h: number };

const COINS = [
  { id: "bitcoin", symbol: "BTC", name: "Bitcoin" },
  { id: "ethereum", symbol: "ETH", name: "Ether" },
  { id: "solana", symbol: "SOL", name: "Solana" },
  { id: "ripple", symbol: "XRP", name: "XRP" },
  { id: "binancecoin", symbol: "BNB", name: "BNB" },
  { id: "dogecoin", symbol: "DOGE", name: "Dogecoin" },
  { id: "cardano", symbol: "ADA", name: "Cardano" },
];

/** CoinGecko free API, cached by Next for 5 minutes so visitors never hit the rate limit. */
export async function getPrices(): Promise<Price[]> {
  const demo = secret("COINGECKO_DEMO_KEY");
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${COINS.map((c) => c.id).join(",")}&vs_currencies=usd&include_24hr_change=true`,
      { headers: demo ? { "x-cg-demo-api-key": demo } : {}, next: { revalidate: 300 }, signal: AbortSignal.timeout(6000) }
    );
    if (!res.ok) return [];
    const json = (await res.json()) as Record<string, { usd?: number; usd_24h_change?: number }>;
    return COINS.filter((c) => typeof json[c.id]?.usd === "number").map((c) => ({ ...c, usd: json[c.id].usd!, change24h: json[c.id].usd_24h_change ?? 0 }));
  } catch {
    return [];
  }
}
