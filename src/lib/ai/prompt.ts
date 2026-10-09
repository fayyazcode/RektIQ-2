import { feedById } from "../config";
import type { PostKind, PostStyle } from "../types";

export type Candidate = {
  title: string;
  summary: string;
  sources: string[];
  sourceNames?: string[];
  publishedAt: Date;
  /** Key facts from the AI summary, when the story has one */
  facts?: string[];
};

export type WrittenKind = Exclude<PostKind, "other">;
export const KINDS: WrittenKind[] = ["breaking", "market", "insight"];

/** Post types for n posts: breaking, market, insight, then repeating, so a busy day gets a mix. */
export const kindsFor = (n: number): WrittenKind[] => Array.from({ length: Math.max(1, n) }, (_, i) => KINDS[i % KINDS.length]);

export type PostRequest = { kind: WrittenKind; style: PostStyle };

/**
 * Character budgets (X counts a link as 23): link posts leave room for the link;
 * the other styles carry the whole story, so they can use nearly all 280.
 */
export const STYLE_LIMIT: Record<PostStyle, number> = { link: 230, detailed: 275, humor: 270 };
/** Kept for callers that only need the link-post budget. */
export const MAX_BODY = STYLE_LIMIT.link;

export type PostMix = { link: number; detailed: number; humor: number };

/**
 * Spreads the styles over the day in proportion to the mix, interleaved rather than
 * clumped (smooth weighted round-robin), so e.g. 50/30/20 over 10 posts gives
 * 5 link, 3 detailed, 2 humor posts, alternating.
 */
export function stylesFor(count: number, mix: PostMix): PostStyle[] {
  const entries = (Object.entries(mix) as [PostStyle, number][]).filter(([, w]) => w > 0);
  if (!entries.length) return Array.from({ length: count }, () => "link");
  const total = entries.reduce((s, [, w]) => s + w, 0);
  const current = new Map<PostStyle, number>(entries.map(([k]) => [k, 0]));
  const out: PostStyle[] = [];
  for (let i = 0; i < count; i++) {
    let best: PostStyle = entries[0][0];
    for (const [k, w] of entries) {
      current.set(k, current.get(k)! + w);
      if (current.get(k)! > current.get(best)!) best = k;
    }
    current.set(best, current.get(best)! - total);
    out.push(best);
  }
  return out;
}

export const SYSTEM_PROMPT = `You write the X (Twitter) posts for a crypto news site. You are sharp, accurate and never boring.

Styles:
- "link": a short, specific hook that makes people want the full story. At most ${STYLE_LIMIT.link} characters. A link is added automatically after your text, so don't add one.
- "detailed": a complete post that needs no link. Say what happened, who is involved, the key numbers, and why it matters, in 1–3 tight sentences (line breaks are fine). Credit the newsroom that reported it ("per CoinDesk", "The Block reports"). At most ${STYLE_LIMIT.detailed} characters.
- "humor": a genuinely funny, light post about the story: wordplay, irony, a relatable crypto-culture observation. The real facts must still be clear and correct inside the joke. At most ${STYLE_LIMIT.humor} characters, at most 2 emoji. Punch at situations and markets, never at people, groups, victims or anyone who lost money. Never use humor on stories marked [serious].

Rules for every post:
- Use only facts from the story material. Never invent numbers, names, quotes, prices or market conditions. Every number you write must appear in the material.
- No financial advice, no price predictions, no "buy/sell" calls, no "not financial advice" disclaimers.
- No links in your text. At most 2 hashtags, only when they help discovery (#Bitcoin, #ETH).
- Each post is about a different story.

Respond with JSON only.`;

export function userPrompt(candidates: Candidate[], requests: PostRequest[], serious: boolean[]) {
  const list = candidates
    .map((c, i) => {
      const sources = c.sources.map((s, index) => c.sourceNames?.[index] ?? feedById(s)?.name ?? s).join(", ");
      const facts = c.facts?.length ? `\nKey facts:\n${c.facts.map((f) => `- ${f}`).join("\n")}` : "";
      return `[${i}]${serious[i] ? " [serious]" : ""} ${c.title}\nCovered by: ${sources} (${c.sources.length} newsroom${c.sources.length > 1 ? "s" : ""})\nPublished: ${c.publishedAt.toISOString()}\nSummary: ${c.summary}${facts}`;
    })
    .join("\n\n");
  const describe: Record<WrittenKind, string> = {
    breaking: "the most important development (stories covered by more newsrooms usually matter more)",
    market: "a market story (prices, ETF flows, liquidations, macro, trading)",
    insight: "a trend or bigger-picture takeaway (you may connect two related stories, citing the main one)",
  };
  const asks = requests.map((r, i) => `${i + 1}. style "${r.style}", kind "${r.kind}": ${describe[r.kind]}`).join("\n");
  return `Stories:\n\n${list}\n\nWrite ${requests.length} post${requests.length > 1 ? "s" : ""}, in this order, each about a DIFFERENT story:\n${asks}\n\nReturn exactly this shape, one entry per numbered item, in order:\n{"posts":[{"kind":"${requests[0].kind}","style":"${requests[0].style}","storyIndex":0,"text":"..."}]}`;
}
