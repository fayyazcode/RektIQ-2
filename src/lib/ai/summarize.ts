import { z } from "zod";
import { callGemini, callGroq } from "./providers";
import { unknownNumbers } from "./facts";
import { truncate } from "../normalize/text";
import { feedById } from "../config";
import { secret } from "../env";
import type { AiSummary } from "../types";

export type SummaryInput = {
  title: string;
  articles: { source: string; title: string; summary: string; publishedAt: Date }[];
  sourceNames?: Record<string, string>;
};

const SYSTEM = `You write short, original news summaries for a crypto news site, combining what several newsrooms reported about one event.

Rules:
- Use only facts found in the material. Never invent numbers, names, quotes, dates or reasons. Every number you write must appear in the material.
- Write in your own words; don't copy sentences from the material.
- Neutral, plain English. No hype, no predictions, no financial advice.
- If newsrooms disagree on a detail, say so briefly.

Return JSON only:
{"whatHappened":"2-3 sentences, at most 420 characters","whyItMatters":"1-2 sentences, at most 280 characters","keyFacts":["2-5 short facts, each at most 120 characters"]}`;

const Schema = z.object({
  whatHappened: z.string().min(40),
  whyItMatters: z.string().min(20),
  keyFacts: z.array(z.string().min(5)).min(1).max(8),
});

export function buildPrompt(input: SummaryInput) {
  const body = input.articles
    .map((a) => `- ${input.sourceNames?.[a.source] ?? feedById(a.source)?.name ?? a.source} (${a.publishedAt.toISOString()}): ${a.title}\n  ${a.summary}`)
    .join("\n");
  return `Event: ${input.title}\n\nWhat each newsroom reported:\n${body}`;
}

/** Parses and fact-checks a summary. Facts with invented numbers are dropped; an invented number in the main text rejects it. */
export function parseSummary(raw: string, input: SummaryInput): Omit<AiSummary, "writtenBy" | "at" | "sourceCount"> | null {
  const clean = raw.replace(/```(json)?/g, "").trim();
  const parsed = Schema.safeParse(JSON.parse(clean.slice(clean.indexOf("{"), clean.lastIndexOf("}") + 1)));
  if (!parsed.success) return null;
  const material = [input.title, ...input.articles.flatMap((a) => [a.title, a.summary])];
  const noLinks = (s: string) => s.replace(/https?:\/\/\S+/g, "").trim();
  const whatHappened = noLinks(parsed.data.whatHappened);
  const whyItMatters = noLinks(parsed.data.whyItMatters);
  if (unknownNumbers(`${whatHappened} ${whyItMatters}`, material).length) return null;
  const keyFacts = parsed.data.keyFacts.map(noLinks).filter((f) => !unknownNumbers(f, material).length).slice(0, 5);
  return {
    whatHappened: truncate(whatHappened, 480),
    whyItMatters: truncate(whyItMatters, 320),
    keyFacts: keyFacts.map((f) => truncate(f, 140)),
  };
}

export async function summarizeStory(input: SummaryInput): Promise<{ summary: Omit<AiSummary, "at" | "sourceCount"> | null; error: string | null }> {
  const providers: ["groq" | "gemini", typeof callGemini, string | undefined][] = [
    ["groq", callGroq, secret("GROQ_API_KEY")],
    ["gemini", callGemini, secret("GEMINI_API_KEY")],
  ];
  const errors: string[] = [];
  for (const [name, call, key] of providers) {
    if (!key) continue;
    try {
      const s = parseSummary(await call(SYSTEM, buildPrompt(input)), input);
      if (s) return { summary: { ...s, writtenBy: name }, error: null };
      errors.push(`${name}: summary failed the fact check`);
    } catch (err) {
      errors.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { summary: null, error: errors.join(" | ") || "No AI key set" };
}
