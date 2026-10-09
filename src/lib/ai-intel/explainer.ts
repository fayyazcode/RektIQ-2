/**
 * AI signal explanation (Phase 10) — provider abstraction with strict output
 * validation. AI only EXPLAINS deterministic evidence; it never invents numbers,
 * sources or events, and never overrides scores. Outputs are schema-validated
 * (zod) and cached by a hash of the normalized evidence so AI is not called on
 * every price refresh.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { config, hasSecret, secret } from "../env";
import { callGemini, callGroq } from "../ai/providers";
import { eq } from "drizzle-orm";
import { getPostgresDb } from "../db/client";
import { aiAnalyses } from "../db/schema";
import { hasDatabase } from "../db";

export const PROMPT_VERSION = "intel-explain-v1";

/** Strict output contract — anything else is rejected, not repaired. */
export const AiExplanationSchema = z.object({
  signalLabel: z.string().min(3).max(60),
  confidence: z.enum(["low", "medium", "high"]),
  summary: z.string().min(20).max(600),
  evidence: z.array(z.string().min(5).max(240)).min(1).max(8),
  caveats: z.array(z.string().min(5).max(240)).max(5),
});
export type AiExplanation = z.infer<typeof AiExplanationSchema>;

export type EvidencePacket = {
  kind: "signal" | "news_impact" | "asset";
  symbol: string;
  /** Only deterministic, already-computed facts. Numbers must appear verbatim in `summary` checks. */
  facts: Record<string, number | string | null>;
  formulaVersion: string;
};

export interface AiProvider {
  readonly id: string;
  readonly model: string;
  analyzeSignal(input: EvidencePacket): Promise<AiExplanation>;
  explainNewsImpact(input: EvidencePacket): Promise<AiExplanation>;
}

const SYSTEM_PROMPT = `You are a crypto market analyst explaining a deterministic score to readers.
Rules you must follow exactly:
- Use ONLY the numbers and facts provided in the input. Never invent prices, percentages, sources, events or dates.
- Never claim certainty. The score is a statistical summary, not a prediction.
- Do not give investment advice. Do not say "buy", "sell", "guaranteed", "100x".
- Describe what the evidence shows and what its limits are.
Return STRICT JSON only, matching exactly this shape:
{"signalLabel": string, "confidence": "low"|"medium"|"high", "summary": string, "evidence": string[], "caveats": string[]}`;

function userPrompt(input: EvidencePacket): string {
  return JSON.stringify({ task: input.kind, symbol: input.symbol, formulaVersion: input.formulaVersion, facts: input.facts });
}

/** Extract + validate the JSON object out of a model reply; throws when invalid. */
export function parseExplanation(raw: string, evidence: EvidencePacket): AiExplanation {
  const clean = raw.replace(/```(json)?/g, "").trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("AI response contains no JSON object");
  const obj = JSON.parse(clean.slice(start, end + 1));
  const parsed = AiExplanationSchema.parse(obj); // malformed → throws, caller falls back
  assertNoInventedNumbers(parsed, evidence);
  return parsed;
}

/**
 * Numbers used in the AI text must exist in the evidence packet (rounded
 * tolerance). Takes the whole packet so structural values — the timeframe
 * labels inside fact keys ("priceChange24h" ⇒ 24) and the formula version —
 * are allowed without weakening the check on real claims.
 */
export function assertNoInventedNumbers(ex: AiExplanation, evidence: EvidencePacket) {
  const allowed = new Set<string>(collectAllowedStrings(collectAllowed(evidence.facts)));
  for (const m of `${Object.keys(evidence.facts).join(" ")} ${evidence.formulaVersion}`.matchAll(/\d+(?:\.\d+)?/g)) {
    allowed.add(m[0]);
  }
  const text = [ex.summary, ...ex.evidence, ...ex.caveats].join(" ");
  for (const m of text.matchAll(/(?<![\w.])\d+(?:\.\d+)?(?![\w])/g)) {
    const n = m[0];
    if (!allowed.has(n) && !allowed.has(n.replace(/\.0+$/, ""))) {
      // small integers like list indices are structural, not market claims
      if (Number.isInteger(Number(n)) && Number(n) <= 12) continue;
      throw new Error(`AI invented the number "${n}" which is not in the evidence`);
    }
  }
}

function collectAllowedStrings(values: (number | string | null)[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    if (typeof v === "number" && isFinite(v)) {
      out.push(String(Math.round(v)));
      out.push(String(Math.round(v * 100) / 100));
      out.push(String(Math.round(v * 100)));
      out.push(String(Math.round(v / 1e6)));
      out.push(String(Math.round(v / 1e9)));
    } else if (typeof v === "string") {
      for (const m of v.matchAll(/\d+(?:\.\d+)?/g)) out.push(m[0]);
    }
  }
  return out;
}

function collectAllowed(facts: EvidencePacket["facts"]): (number | string | null)[] {
  const out: (number | string | null)[] = [];
  for (const v of Object.values(facts)) {
    if (typeof v === "number" || typeof v === "string" || v === null) out.push(v);
  }
  return out;
}

/** Wrap a raw-text LLM callable into an AiProvider with validation. */
function makeTextProvider(id: string, model: string, call: (s: string, u: string) => Promise<string>): AiProvider {
  const run = async (input: EvidencePacket): Promise<AiExplanation> => {
    const raw = await call(SYSTEM_PROMPT, userPrompt(input));
    const ex = parseExplanation(raw, input);
    return ex;
  };
  return {
    id,
    model,
    analyzeSignal: run,
    explainNewsImpact: run,
  };
}

/** Jev adapter — active only when JEV_API_KEY is configured. Replaceable adapter. */
export function createJevProvider(): AiProvider {
  const key = secret("JEV_API_KEY");
  if (!key) throw new Error("JEV_API_KEY is not set");
  const model = config("JEV_MODEL", "jev-signal-explainer")!;
  const call = async (system: string, user: string): Promise<string> => {
    const res = await fetch("https://api.jev.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) throw new Error(`Jev HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = json.choices?.[0]?.message?.content ?? "";
    if (!text) throw new Error("Jev returned an empty response");
    return text;
  };
  return makeTextProvider("jev", model, call);
}

/* ── Deterministic fallback (no network, always available) ── */

export function ruleBasedExplanation(input: EvidencePacket): AiExplanation {
  const f = input.facts;
  const score = typeof f.score === "number" ? f.score : null;
  const chg = typeof f.priceChange24h === "number" ? f.priceChange24h : null;
  const label = score === null ? "Data snapshot" : score >= 75 ? "Strong momentum" : score >= 55 ? "Constructive tone" : score > 45 ? "Mixed signals" : score > 30 ? "Soft conditions" : "Weak conditions";
  const evidence: string[] = [];
  if (chg !== null) evidence.push(`${input.symbol} moved ${chg >= 0 ? "+" : ""}${chg}% over 24h.`);
  if (typeof f.volume24h === "number") evidence.push(`24h volume was $${Math.round(f.volume24h / 1e6)}M.`);
  if (typeof f.marketCap === "number") evidence.push(`Market cap is roughly $${Math.round(f.marketCap / 1e9)}B.`);
  if (typeof f.newsCount24h === "number") evidence.push(`${f.newsCount24h} news article(s) mentioned it in the last 24 hours.`);
  if (typeof f.observedPriceChangePct === "number") evidence.push(`Observed movement after publication: ${f.observedPriceChangePct >= 0 ? "+" : ""}${f.observedPriceChangePct}%.`);
  return {
    signalLabel: label,
    confidence: evidence.length >= 3 ? "medium" : "low",
    summary: `${input.symbol}: ${label.toLowerCase()} based on ${evidence.length} measured factor(s). This is a statistical summary of recent data, not a forecast.`,
    evidence: evidence.length ? evidence : [`${input.symbol} data point recorded (${input.formulaVersion}).`],
    caveats: ["Scores describe recent behaviour, not future results.", "Provider data can be delayed or revised."],
  };
}

/* ── Registry + caching ────────────────────────────────────── */

export function aiProviders(): AiProvider[] {
  const order = (config("AI_PROVIDER_ORDER", "groq,jev,gemini") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const list: AiProvider[] = [];
  for (const name of order) {
    try {
      if (name === "jev" && hasSecret("JEV_API_KEY")) list.push(createJevProvider());
      else if (name === "gemini" && hasSecret("GEMINI_API_KEY")) list.push(makeTextProvider("gemini", config("GEMINI_MODEL", "gemini-2.5-flash")!, callGemini));
      else if (name === "groq" && hasSecret("GROQ_API_KEY")) list.push(makeTextProvider("groq", config("GROQ_MODEL", "openai/gpt-oss-20b")!, callGroq));
    } catch (err) {
      console.warn(`[ai] provider "${name}" unavailable:`, err instanceof Error ? err.message : err);
    }
  }
  return list;
}

export function evidenceHash(input: EvidencePacket): string {
  return createHash("sha256").update(JSON.stringify([input.kind, input.symbol, input.formulaVersion, input.facts])).digest("hex").slice(0, 32);
}

export type StoredAnalysis = {
  result: AiExplanation;
  provider: string;
  model: string;
  promptVersion: string;
  createdAt: string;
  cached: boolean;
};

/**
 * Explain evidence with the first working provider; cache per evidence hash;
 * fall back to the deterministic rule-based text when every provider fails.
 */
export async function explain(input: EvidencePacket, opts: { force?: boolean } = {}): Promise<StoredAnalysis> {
  const hash = evidenceHash(input);
  const db = hasDatabase();
  if (db && !opts.force) {
    try {
      const [hit] = await getPostgresDb().select().from(aiAnalyses).where(eq(aiAnalyses.inputHash, hash)).limit(1);
      if (hit) {
        return { result: AiExplanationSchema.parse(hit.result), provider: hit.provider, model: hit.model, promptVersion: hit.promptVersion, createdAt: hit.createdAt.toISOString(), cached: true };
      }
    } catch (err) {
      console.warn("[ai] cached analysis unavailable:", err instanceof Error ? err.message : err);
    }
  }

  let result: AiExplanation | null = null;
  let provider = "rules";
  let model = "rule-based-v1";
  for (const p of aiProviders()) {
    try {
      result = input.kind === "news_impact" ? await p.explainNewsImpact(input) : await p.analyzeSignal(input);
      provider = p.id;
      model = p.model;
      break;
    } catch (err) {
      console.warn(`[ai] ${p.id} failed:`, err instanceof Error ? err.message : err);
    }
  }
  if (!result) result = ruleBasedExplanation(input);

  if (db) {
    try {
      const now = new Date();
      await getPostgresDb()
        .insert(aiAnalyses)
        .values({
          kind: input.kind,
          refType: input.kind,
          refId: hash,
          symbol: input.symbol,
          inputHash: hash,
          result,
          provider,
          model,
          promptVersion: PROMPT_VERSION,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: aiAnalyses.inputHash,
          set: { result, provider, model, promptVersion: PROMPT_VERSION, updatedAt: now },
        });
    } catch (err) {
      console.warn("[ai] could not store analysis:", err instanceof Error ? err.message : err);
    }
  }
  return { result, provider, model, promptVersion: PROMPT_VERSION, createdAt: new Date().toISOString(), cached: false };
}
