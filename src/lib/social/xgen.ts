/**
 * X post generation from structured evidence (Phase 12). The client sends only
 * a reference (signal/anomaly/news-impact id + version tag); the server loads
 * the stored deterministic evidence itself, so no arbitrary numbers or raw
 * instructions can be injected. Generation NEVER publishes — publishing stays
 * behind admin approval in /admin/posts via the existing Buffer pipeline.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getPostgresDb } from "../db/client";
import { marketSignals, anomalies, newsImpacts } from "../db/schema";
import { config, hasSecret } from "../env";
import { callGemini, callGroq } from "../ai/providers";
import { truncate } from "../normalize/text";
import { xLength } from "./tweet";
import type { PostStyle } from "../types";

export const XGEN_PROMPT_VERSION = "xgen-v1";

export const GenerateRequestSchema = z.object({
  refType: z.enum(["signal", "anomaly", "news_impact"]),
  refId: z.string().regex(/^[a-f0-9-]{8,64}$/i),
});

export type GeneratedPost = { style: PostStyle; text: string };

const HYPE = /\b(to the moon|insane gains|guaranteed|100x|1000x|buy now|sell now|get in|don't miss)\b/i;
// degen humour is allowed to joke about the data, never to promise returns
const DEGEN_BANNED = /(guaranteed|will (go|pump|moon)|going to (moon|pump)|100x|definitely (up|down)|risk-?free)/i;

/** Neutral, factual lines derived ONLY from stored evidence. Shared by LLM prompt + fallback. */
export function factLines(evidence: Record<string, unknown>, symbol: string, kindLabel: string): string[] {
  const n = (key: string): number | null => {
    const v = evidence[key];
    return typeof v === "number" && isFinite(v) ? v : null;
  };
  const out: string[] = [`${symbol} — ${kindLabel}.`];
  const price = n("price");
  if (price !== null) out.push(`Price: $${price.toLocaleString("en-US", { maximumFractionDigits: price < 1 ? 6 : 2 })}`);
  const chg = n("priceChange24h");
  if (chg !== null) out.push(`24h change: ${chg >= 0 ? "+" : ""}${chg}%`);
  const vol = n("volume24h");
  if (vol !== null) out.push(`24h volume: $${Math.round(vol / 1e6).toLocaleString("en-US")}M`);
  const mcap = n("marketCap");
  if (mcap !== null) out.push(`Market cap: $${(mcap / 1e9).toFixed(2)}B`);
  const score = n("score");
  if (score !== null) out.push(`RecktIQ Live Score: ${score}/100`);
  const ratio = n("ratio");
  if (ratio !== null) out.push(`Observed vs baseline: ${ratio}×`);
  const observed = n("observed");
  const baseline = n("baseline");
  if (observed !== null && baseline !== null) out.push(`Observed value ${observed} against a baseline of ${baseline}.`);
  const pct = n("priceChangePct");
  if (pct !== null) out.push(`Observed market movement after publication: ${pct >= 0 ? "+" : ""}${pct}% (correlation, not causation).`);
  return out;
}

const SYSTEM = `You write short posts for a crypto news account about one measured event.
Rules:
- Use ONLY the facts given. Never invent numbers, sources, causes or predictions.
- Never promise results or give investment advice. No "guaranteed", "100x", "will pump".
- Correlation is not causation: when describing news impact say "observed movement after publication".
Return STRICT JSON: {"posts":[{"style":"link"|"detailed"|"humor","text":string}]}`;

const Schema = z.object({
  posts: z.array(z.object({ style: z.enum(["link", "detailed", "humor"]), text: z.string().min(10) })).min(1).max(3),
});

function parsePosts(raw: string): { style: PostStyle; text: string }[] {
  const clean = raw.replace(/```(json)?/g, "").trim();
  const obj = JSON.parse(clean.slice(clean.indexOf("{"), clean.lastIndexOf("}") + 1));
  return Schema.parse(obj).posts;
}

async function llmGenerate(facts: string[], headline?: string): Promise<GeneratedPost[]> {
  const order = (config("AI_PROVIDER_ORDER", "groq,jev,gemini") || "").split(",").map((s) => s.trim());
  const user = JSON.stringify({ facts, headline: headline ?? null, styles: ["factual (link)", "concise (detailed)", "degen humour (humor)"] });
  void order; // Jev adapter lives in ai-intel/explainer; X text uses the proven Gemini/Groq callers first
  for (const [name, model, call] of [
    ["groq", config("GROQ_MODEL", "openai/gpt-oss-20b")!, callGroq],
    ["gemini", config("GEMINI_MODEL", "gemini-2.5-flash")!, callGemini],
  ] as const) {
    if (!hasSecret(name === "gemini" ? "GEMINI_API_KEY" : "GROQ_API_KEY")) continue;
    try {
      const drafts = parsePosts(await call(SYSTEM, user));
      const seen = new Set<PostStyle>();
      const out: GeneratedPost[] = [];
      for (const d of drafts) {
        if (seen.has(d.style)) continue;
        const limit = d.style === "link" ? 280 : d.style === "detailed" ? 480 : 280;
        let text = d.text.replace(/https?:\/\/\S+/g, "").trim();
        if (HYPE.test(text) || (d.style === "humor" && DEGEN_BANNED.test(text))) continue;
        if (xLength(text) > limit) text = truncate(text, limit - 1) + "…";
        if (xLength(text) < 20) continue;
        seen.add(d.style);
        out.push({ style: d.style, text });
      }
      if (out.length) return out;
    } catch (err) {
      console.warn(`[xgen] ${name} failed:`, err instanceof Error ? err.message : err);
    }
  }
  return [];
}

/** Deterministic fallback built straight from the evidence — always works. */
export function templatePosts(symbol: string, kindLabel: string, facts: string[]): GeneratedPost[] {
  const concise = facts.slice(0, 3);
  const chgLine = facts.find((f) => f.startsWith("24h change"));
  const scoreLine = facts.find((f) => f.startsWith("RecktIQ Live Score"));
  const humor = (() => {
    if (chgLine) {
      const pct = Number(chgLine.match(/[-+]?[\d.]+/)?.[0] ?? 0);
      if (pct > 5) return `${symbol} up ${String(pct).replace("+", "")}% in 24h. The charts are louder than my morning alarm. (${scoreLine ?? "Score on our radar."}) Not advice — just data.`;
      if (pct < -5) return `${symbol} down ${Math.abs(pct)}% in 24h. Someone moved the cheese. Data, not destiny — and definitely not advice.`;
    }
    return `${symbol}: the numbers spoke, we transcribed. ${scoreLine ?? ""} Measurement, not advice.`.replace(/\s+/g, " ").trim();
  })();
  return [
    { style: "link", text: facts.join("\n") },
    { style: "detailed", text: `${symbol} — ${kindLabel}\n\n${concise.join(" · ")}\n\nMeasured by RecktIQ's live scoring. Statistics, not signals to trade on.` },
    { style: "humor", text: humor },
  ];
}

export type GenerateResult = { posts: GeneratedPost[]; source: "ai" | "template"; evidence: string[]; generatedAt: string; promptVersion: string };

/** Load stored evidence server-side; returns null when the reference doesn't exist. */
export async function loadEvidence(refType: z.infer<typeof GenerateRequestSchema>["refType"], refId: string): Promise<{ symbol: string; label: string; evidence: Record<string, unknown>; headline?: string } | null> {
  try {
    const db = getPostgresDb();
    if (refType === "signal") {
      const doc = await db.select().from(marketSignals).where(eq(marketSignals.id, refId)).limit(1);
      if (!doc[0]) return null;
      return { symbol: doc[0].symbol, label: `${doc[0].type.toUpperCase()} signal (score ${doc[0].score}/100)`, evidence: doc[0].evidence };
    }
    if (refType === "anomaly") {
      const doc = await db.select().from(anomalies).where(eq(anomalies.id, refId)).limit(1);
      if (!doc[0]) return null;
      return { symbol: doc[0].symbol, label: `${doc[0].type.replace(/_/g, " ")} anomaly (${doc[0].severity})`, evidence: { ratio: doc[0].ratio, observed: doc[0].observed, baseline: doc[0].baseline } };
    }
    const doc = await db.select().from(newsImpacts).where(eq(newsImpacts.id, refId)).limit(1);
    if (!doc[0]) return null;
    return {
      symbol: doc[0].symbol,
      label: "observed movement after publication",
      evidence: { priceChangePct: doc[0].priceChangePct, ratio: doc[0].volumeReactionRatio, price: doc[0].priceAfter },
      headline: doc[0].headline,
    };
  } catch {
    return null;
  }
}

export async function generateForRef(refType: "signal" | "anomaly" | "news_impact", refId: string): Promise<GenerateResult | { error: string }> {
  const ref = await loadEvidence(refType, refId);
  if (!ref) return { error: "Reference not found" };
  const facts = factLines(ref.evidence, ref.symbol, ref.label);
  const posts = await llmGenerate(facts, ref.headline);
  return {
    posts: posts.length ? posts : templatePosts(ref.symbol, ref.label, facts),
    source: posts.length ? "ai" : "template",
    evidence: facts,
    generatedAt: new Date().toISOString(),
    promptVersion: XGEN_PROMPT_VERSION,
  };
}

export function xgenCacheKey(refType: string, refId: string): string {
  return createHash("sha256").update(`${refType}:${refId}:${XGEN_PROMPT_VERSION}`).digest("hex").slice(0, 32);
}
