import type { Category } from "../types";

/**
 * Every feed tags differently ("BTC", "Bitcoin News", "Markets", "Business/Finance"...).
 * Tags and headline keywords are mapped onto one fixed taxonomy.
 */
const RULES: [Category, RegExp][] = [
  ["bitcoin", /\b(bitcoin|btc|satoshi|lightning network|ordinals?|runes)\b/i],
  ["ethereum", /\b(ethereum|ether|eth|vitalik|pectra|fusaka|dencun|eip-?\d+)\b/i],
  ["altcoins", /\b(solana|sol|xrp|ripple|cardano|ada|dogecoin|doge|bnb|avalanche|avax|polkadot|tron|trx|toncoin|ton|litecoin|ltc|sui|aptos|chainlink|link|memecoins?|altcoins?)\b/i],
  ["defi", /\b(defi|decentralized finance|dex|uniswap|aave|lending protocol|liquidity pools?|yield|tvl|restaking|lido|curve|maker|sky)\b/i],
  ["markets", /\b(markets?|price|prices|rally|rallies|drops?|slump|surges?|sell-?off|liquidations?|trading|traders|futures|options|volatility|all-time high|ath|bull|bear|funding rates?|open interest)\b/i],
  ["etf", /\b(etfs?|exchange-traded|spot etf|ibit|fbtc|grayscale|blackrock fund)\b/i],
  ["regulation", /\b(sec|cftc|regulat\w*|lawsuit|court|judge|settlement|enforcement|compliance|licen[cs]e|mica|fca|doj|charges?|sanctions?)\b/i],
  ["policy", /\b(congress|senate|bill|act|white house|treasury|fed|federal reserve|central bank|cbdc|tax|election|government|minister|policy)\b/i],
  ["stablecoins", /\b(stablecoins?|usdt|usdc|tether|circle|dai|pyusd|genius act)\b/i],
  ["nft", /\b(nfts?|non-fungible|opensea|collectibles?)\b/i],
  ["layer-2", /\b(layer[- ]?2|l2s?|rollups?|arbitrum|optimism|base chain|zksync|starknet|polygon|scroll|linea)\b/i],
  ["mining", /\b(min(ing|ers?)|hash ?rate|hashprice|difficulty|asics?|halving)\b/i],
  ["security", /\b(hacks?|hacked|exploits?|breach|stolen|drain(ed|er)?|phishing|scam|rug ?pull|vulnerabilit\w+|attackers?|ransomware|lazarus)\b/i],
  ["business", /\b(raises?|funding round|acquires?|acquisition|ipo|earnings|revenue|layoffs?|partnership|venture|valuation|ceo)\b/i],
  ["ai", /\b(ai|artificial intelligence|llm|agents?|openai|machine learning)\b/i],
  ["technology", /\b(upgrade|hard fork|testnet|mainnet|protocol|developers?|zero-knowledge|zk|smart contracts?|wallet|node)\b/i],
];

export const CATEGORY_LABELS: Record<Category, string> = {
  bitcoin: "Bitcoin", ethereum: "Ethereum", altcoins: "Altcoins", defi: "DeFi", markets: "Markets",
  etf: "ETFs", regulation: "Regulation", policy: "Policy", stablecoins: "Stablecoins", nft: "NFTs",
  "layer-2": "Layer 2", mining: "Mining", security: "Security", business: "Business", ai: "AI", technology: "Technology",
};

export const ALL_CATEGORIES = Object.keys(CATEGORY_LABELS) as Category[];

export function categorize(title: string, summary: string, rawTags: string[]): Category[] {
  // Headline and tags count fully; the summary only confirms (needs a title/tag hit or two summary hits).
  const head = `${title} ${rawTags.join(" ")}`;
  const found: Category[] = [];
  for (const [cat, re] of RULES) {
    if (re.test(head)) found.push(cat);
    else {
      const hits = summary.match(new RegExp(re.source, "gi"));
      if (hits && hits.length >= 2) found.push(cat);
    }
  }
  return found.slice(0, 5);
}

/** Ticker detection → canonical symbols */
const COINS: [string, RegExp][] = [
  ["BTC", /\b(bitcoin|btc)\b/i],
  ["ETH", /\b(ethereum|ether|eth)\b/i],
  ["SOL", /\b(solana|sol)\b/],
  ["XRP", /\b(xrp|ripple)\b/i],
  ["BNB", /\b(bnb|binance coin)\b/i],
  ["DOGE", /\b(dogecoin|doge)\b/i],
  ["ADA", /\b(cardano|ada)\b/],
  ["TON", /\b(toncoin|ton)\b/],
  ["AVAX", /\b(avalanche|avax)\b/i],
  ["LINK", /\b(chainlink)\b/i],
  ["USDT", /\b(tether|usdt)\b/i],
  ["USDC", /\b(usdc)\b/i],
  ["SUI", /\bsui\b/i],
  ["TRX", /\b(tron|trx)\b/i],
  ["LTC", /\b(litecoin|ltc)\b/i],
  ["DOT", /\b(polkadot)\b/i],
  ["HYPE", /\b(hyperliquid)\b/i],
];

export function detectCoins(text: string): string[] {
  return COINS.filter(([, re]) => re.test(text)).map(([sym]) => sym).slice(0, 6);
}
