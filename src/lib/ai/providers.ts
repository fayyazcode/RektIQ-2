import { env, requireSecret } from "../env";
/** Free-tier LLM providers. Each returns raw text; parsing/validation happens upstream. */

export async function callGemini(system: string, user: string): Promise<string> {
  const key = requireSecret("GEMINI_API_KEY");
  const model = env.geminiModel();
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 2048, responseMimeType: "application/json" },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text) throw new Error("Gemini returned an empty response");
  return text;
}

export async function callGroq(system: string, user: string): Promise<string> {
  const key = requireSecret("GROQ_API_KEY");
  const request = (jsonMode: boolean) => fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: env.groqModel(),
      temperature: 0.4,
      max_tokens: 1500,
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  });

  let res = await request(true);
  if (!res.ok) {
    const detail = await res.text();
    if (res.status === 400 && detail.includes("json_validate_failed")) {
      // Groq's JSON Object Mode can reject an otherwise usable generation.
      // Every call site already asks for JSON and validates it before use, so
      // retry once in text mode and let those existing guards decide whether
      // the response is safe to accept.
      res = await request(false);
      if (!res.ok) throw new Error(`Groq HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    } else {
      throw new Error(`Groq HTTP ${res.status}: ${detail.slice(0, 300)}`);
    }
  }
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = json.choices?.[0]?.message?.content ?? "";
  if (!text) throw new Error("Groq returned an empty response");
  return text;
}
