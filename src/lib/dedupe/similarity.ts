/**
 * Text similarity for near-duplicate detection across newsrooms.
 * Deliberately dependency-free and deterministic so it can be unit-tested.
 */

const STOPWORDS = new Set(
  (
    "a an the and or but if then than so of to in on at by for from with without into onto over under about after before " +
    "as is are was were be been being has have had do does did will would can could should may might must shall " +
    "this that these those it its it's they them their there here he she his her we our you your i me my " +
    "not no yes new says said say report reports reported according amid while during via per vs versus up down out off " +
    "what why how who when where which more most less least very just also still now today week weeks day days month year " +
    "first last next back big top key major latest update updates news crypto cryptocurrency cryptocurrencies " +
    "market markets price prices amid set sets gets get got make makes made posts posted sees see saw hits logs"
  ).split(" ")
);

const WORD_NUMBERS: Record<string, string> = { thousand: "k", million: "m", billion: "b", trillion: "t" };

/** "$900 million" → "900m", "$118,000" → "118k", "1.2B" → "1.2b", "12%" → "12%" */
export function normalizeNumbers(text: string): string {
  return text
    .replace(/\$\s?/g, "")
    .replace(/(\d),(\d{3})(?!\d)/g, "$1$2")
    .replace(/(\d),(\d{3})(?!\d)/g, "$1$2")
    .replace(/\b(\d+(?:\.\d+)?)\s*(thousand|million|billion|trillion)\b/gi, (_, n, w: string) => `${n}${WORD_NUMBERS[w.toLowerCase()]}`)
    .replace(/\b(\d+(?:\.\d+)?)\s?([kmbt])n?\b/gi, (_, n, u: string) => `${n}${u.toLowerCase()}`)
    .replace(/\b(\d+)000\b/g, (m, n) => (m.length >= 5 ? `${n}k` : m));
}

function stem(w: string): string {
  if (/^\d/.test(w) || w.length <= 3) return w;
  if (w.endsWith("ies") && w.length > 4) return w.slice(0, -3) + "y";
  if (w.endsWith("ing") && w.length > 5) return w.slice(0, -3);
  if (w.endsWith("ed") && w.length > 4) return w.slice(0, -2);
  if (w.endsWith("es") && /(ss|x|ch|sh)es$/.test(w)) return w.slice(0, -2);
  if (w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us")) return w.slice(0, -1);
  return w;
}

const ALIASES: Record<string, string> = {
  btc: "bitcoin", eth: "ethereum", ether: "ethereum", sol: "solana", xrp: "ripple", doge: "dogecoin",
  etf: "etf", "exchange-traded": "etf", u: "us", usa: "us", "u.s": "us", sec: "sec", fed: "fed",
  hack: "exploit", hacked: "exploit", exploited: "exploit", drain: "exploit", drained: "exploit",
  surge: "rise", surges: "rise", soar: "rise", soars: "rise", jump: "rise", jumps: "rise", climb: "rise", climbs: "rise", rally: "rise", rallies: "rise",
  plunge: "fall", plunges: "fall", drop: "fall", drops: "fall", slide: "fall", slides: "fall", tumble: "fall", tumbles: "fall", sink: "fall", sinks: "fall",
  inflow: "inflow", inflows: "inflow", outflow: "outflow", outflows: "outflow",
  revenue: "earning", revenues: "earning", profit: "earning", profits: "earning", earnings: "earning", results: "earning",
  estimates: "estimate", expectations: "estimate", forecasts: "estimate",
  above: "beat", tops: "beat", beats: "beat", exceeds: "beat", misses: "miss", below: "miss",
  sues: "lawsuit", sued: "lawsuit", suit: "lawsuit",
};

/**
 * Named players. Two headlines about the same kind of event ("mints $1B", "lists token")
 * are different stories when they name different players.
 */
const ENTITIES = new Set(
  (
    "binance coinbase kraken okx bybit bitget robinhood bitfinex bitstamp upbit kucoin gemini hyperliquid " +
    "tether circle paxos ethena sky maker " +
    "blackrock fidelity grayscale vaneck ark bitwise invesco franklin wisdomtree microstrategy strategy metaplanet " +
    "bitcoin ethereum solana ripple cardano tron ton avalanche polygon arbitrum optimism sui aptos bnb dogecoin chainlink " +
    "uniswap aave lido eigenlayer pendle jupiter"
  ).split(" ")
);

/** Unique content tokens in order of first appearance. */
export function tokenize(text: string): string[] {
  const norm = normalizeNumbers(text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase())
    .replace(/u\.s\./g, "us")
    .replace(/['’]s\b/g, "");
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of norm.split(/[^a-z0-9%.]+/)) {
    const w0 = raw.replace(/^\.+|\.+$/g, "");
    if (!w0 || STOPWORDS.has(w0)) continue;
    if (w0.length < 2 && !/\d/.test(w0)) continue;
    const w = ALIASES[w0] ?? stem(w0);
    if (STOPWORDS.has(w) || seen.has(w)) continue;
    seen.add(w);
    out.push(w);
  }
  return out;
}

export function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const A = new Set(a);
  let inter = 0;
  for (const x of new Set(b)) if (A.has(x)) inter++;
  return inter / (A.size + new Set(b).size - inter);
}

export function overlap(a: string[], b: string[]): number {
  const A = new Set(a);
  let inter = 0;
  for (const x of new Set(b)) if (A.has(x)) inter++;
  return inter;
}

const isNumberToken = (t: string) => /^\d/.test(t);

export type Comparable = { titleTokens: string[]; tokens: string[] };

/**
 * 0..1 similarity between two articles/stories.
 * Headline agreement dominates; body agreement confirms. Conflicting figures
 * ("falls to 90k" vs "rises to 120k") are strong evidence of different events.
 */
export function similarity(a: Comparable, b: Comparable): number {
  const tInter = overlap(a.titleTokens, b.titleTokens);
  const tJac = jaccard(a.titleTokens, b.titleTokens);
  const tContain = tInter / Math.max(1, Math.min(a.titleTokens.length, b.titleTokens.length));
  const titleScore = Math.max(tJac, 0.85 * tContain * Math.min(1, tInter / 3));
  const bodyScore = jaccard(a.tokens, b.tokens);
  let score = 0.65 * titleScore + 0.35 * Math.min(1, bodyScore * 1.6);

  const na = a.titleTokens.filter(isNumberToken);
  const nb = b.titleTokens.filter(isNumberToken);
  if (na.length && nb.length && overlap(na, nb) === 0) score *= 0.55;

  const ea = a.titleTokens.filter((t) => ENTITIES.has(t));
  const eb = b.titleTokens.filter((t) => ENTITIES.has(t));
  if (ea.length && eb.length && overlap(ea, eb) === 0) score *= 0.5;
  return Math.min(1, score);
}

export const SAME_STORY_THRESHOLD = 0.4;
export const SAME_SOURCE_THRESHOLD = 0.7;
