import { z } from "zod";
import { callGemini, callGroq } from "./providers";
import { kindsFor, STYLE_LIMIT, SYSTEM_PROMPT, userPrompt, type Candidate, type PostRequest } from "./prompt";
import { isSensitive, unknownNumbers } from "./facts";
import { truncate } from "../normalize/text";
import { xLength } from "../social/tweet";
import { feedById } from "../config";
import { secret } from "../env";
import type { PostKind, PostStyle, SocialPostDoc } from "../types";

export type DraftPost = { kind: PostKind; style: PostStyle; storyIndex: number; text: string };

const Schema = z.object({
  posts: z.array(
    z.object({
      kind: z.enum(["breaking", "market", "insight"]),
      style: z.enum(["link", "detailed", "humor"]).optional(),
      storyIndex: z.number().int().min(0),
      text: z.string().min(10),
    })
  ),
});

const HYPE = /\b(to the moon|mooning|insane gains|guaranteed|100x|1000x|not financial advice|nfa|buy now|sell now|pump it|wagmi)\b/i;

const sourceText = (c: Candidate) => [c.title, c.summary, ...(c.facts ?? [])];

/** Trims to the style's budget, preferring to cut at a sentence end so a detailed post stays complete. */
function fit(text: string, style: PostStyle): string {
  const limit = STYLE_LIMIT[style];
  if (xLength(text) <= limit) return text;
  const sentences = text.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [];
  let out = "";
  for (const s of sentences) {
    if (xLength((out + s).trim()) > limit) break;
    out += s;
  }
  return out.trim().length > limit * 0.5 ? out.trim() : truncate(text, limit);
}

/**
 * Validates the model's answer and lines it up with the requested posts, in order.
 * A post is dropped if it: repeats a story, points at a missing story, contains a link or
 * hype, uses a number that isn't in the story material, or jokes about a serious story.
 */
export function parseAndValidate(raw: string, candidates: Candidate[], requests: PostRequest[]): DraftPost[] {
  return parseAligned(raw, candidates, requests).filter((p): p is DraftPost => p !== null);
}

/** Same checks, but the result lines up with `requests` (null where no valid post fits that slot). */
export function parseAligned(raw: string, candidates: Candidate[], requests: PostRequest[]): (DraftPost | null)[] {
  const clean = raw.replace(/```(json)?/g, "").trim();
  const parsed = Schema.parse(JSON.parse(clean.slice(clean.indexOf("{"), clean.lastIndexOf("}") + 1)));
  const used = new Set<number>();
  const valid: DraftPost[] = [];
  for (const p of parsed.posts) {
    const c = candidates[p.storyIndex];
    if (!c || used.has(p.storyIndex)) continue;
    const style: PostStyle = p.style ?? "link";
    const text = p.text.replace(/https?:\/\/\S+/g, "").replace(/[ \t]+\n/g, "\n").trim();
    if (HYPE.test(text)) continue;
    if (unknownNumbers(text, sourceText(c)).length) continue;
    if (style === "humor" && isSensitive(c.title, c.summary)) continue;
    used.add(p.storyIndex);
    valid.push({ kind: p.kind, style, storyIndex: p.storyIndex, text: fit(text, style) });
  }
  const out: (DraftPost | null)[] = [];
  const taken = new Set<DraftPost>();
  for (const r of requests) {
    // Styles must match (a link post can't stand in for a complete no-link post); the type may differ.
    const match =
      valid.find((v) => !taken.has(v) && v.style === r.style && v.kind === r.kind) ??
      valid.find((v) => !taken.has(v) && v.style === r.style);
    if (!match) {
      out.push(null);
      continue;
    }
    taken.add(match);
    out.push({ ...match, kind: r.kind });
  }
  return out;
}

const MARKET = /\b(price|market|etf|flows?|inflows?|outflows?|liquidat\w*|rally|fall|drop|surge|fed|rate|trading|futures|options|volume)\b/i;
const firstSentence = (s: string) => (s.match(/^[^.!?]+[.!?]/)?.[0] ?? s).trim();

/**
 * Fallback when no AI is available: headline-based posts. There's no safe way to write
 * jokes by rule, so humor slots become detailed posts.
 */
export function ruleBasedPosts(candidates: Candidate[], requests: PostRequest[], exclude = new Set<number>()): DraftPost[] {
  const used = new Set<number>(exclude);
  const pick = (pred: (c: Candidate) => boolean) => {
    let i = candidates.findIndex((c, idx) => !used.has(idx) && pred(c));
    if (i === -1) i = candidates.findIndex((_, idx) => !used.has(idx));
    if (i !== -1) used.add(i);
    return i;
  };
  const out: DraftPost[] = [];
  for (const r of requests) {
    const i = r.kind === "market" ? pick((c) => MARKET.test(c.title)) : r.kind === "insight" ? pick((c) => c.sources.length >= 2) : pick(() => true);
    if (i === -1) break;
    const c = candidates[i];
    const style: PostStyle = r.style === "humor" ? "detailed" : r.style;
    const source = c.sourceNames?.[0] ?? feedById(c.sources[0])?.name ?? c.sources[0];
    const text =
      style === "link"
        ? c.title
        : [c.title.replace(/[.!?]?$/, "."), firstSentence(c.facts?.[0] ?? c.summary), source ? `(via ${source})` : ""].filter(Boolean).join(" ");
    out.push({ kind: r.kind, style, storyIndex: i, text: fit(text, style) });
  }
  return out;
}

/** `want`: a number of link posts, or explicit requests (type + style per post, in order). */
export async function writePosts(
  candidates: Candidate[],
  want: number | PostRequest[]
): Promise<{ posts: DraftPost[]; writtenBy: SocialPostDoc["writtenBy"]; errors: string[] }> {
  const all: PostRequest[] = typeof want === "number" ? kindsFor(want).map((kind) => ({ kind, style: "link" as const })) : want;
  const requests = all.slice(0, Math.max(1, Math.min(all.length, candidates.length)));
  if (!candidates.length) return { posts: [], writtenBy: "rules", errors: [] };
  const serious = candidates.map((c) => isSensitive(c.title, c.summary));
  const errors: string[] = [];
  const providers: [SocialPostDoc["writtenBy"], typeof callGemini, string | undefined][] = [
    ["groq", callGroq, secret("GROQ_API_KEY")],
    ["gemini", callGemini, secret("GEMINI_API_KEY")],
  ];
  for (const [name, call, key] of providers) {
    if (!key) continue;
    try {
      const aligned = parseAligned(await call(SYSTEM_PROMPT, userPrompt(candidates, requests, serious)), candidates, requests);
      if (aligned.some(Boolean)) {
        // A slot whose AI post failed the checks gets a headline-based post on an unused story,
        // in its own position, so posts stay matched to their time slots.
        const used = new Set(aligned.filter((p): p is DraftPost => p !== null).map((p) => p.storyIndex));
        let filled = 0;
        const posts: DraftPost[] = [];
        aligned.forEach((p, i) => {
          if (p) {
            posts.push(p);
            return;
          }
          const [fill] = ruleBasedPosts(candidates, [requests[i]], used);
          if (fill) {
            used.add(fill.storyIndex);
            posts.push(fill);
            filled++;
          }
        });
        if (filled) errors.push(`${name}: ${filled} post(s) failed checks and were written from headlines`);
        return { posts, writtenBy: name, errors };
      }
      errors.push(`${name}: no usable posts`);
    } catch (err) {
      errors.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { posts: ruleBasedPosts(candidates, requests), writtenBy: "rules", errors };
}
