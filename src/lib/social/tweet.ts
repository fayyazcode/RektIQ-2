/**
 * X counts characters with weights: most Latin/punctuation = 1, CJK and emoji = 2,
 * and every URL = 23 regardless of length. This mirrors twitter-text's defaults
 * closely enough to stay under the limit.
 */
export const X_LIMIT = 280;
const URL_WEIGHT = 23;
const URL_RE = /https?:\/\/\S+/g;

function charWeight(cp: number): number {
  if (cp <= 4351) return 1;
  if (cp >= 8192 && cp <= 8205) return 1;
  if (cp >= 8208 && cp <= 8223) return 1;
  if (cp >= 8242 && cp <= 8247) return 1;
  return 2;
}

export function xLength(text: string): number {
  let len = 0;
  const withoutUrls = text.replace(URL_RE, () => {
    len += URL_WEIGHT;
    return "";
  });
  for (const ch of withoutUrls.normalize("NFC")) len += charWeight(ch.codePointAt(0)!);
  return len;
}

/** Trims `body` so that body + link fits in one post. */
export function composePost(body: string, link: string | null): string {
  const clean = body.replace(URL_RE, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const suffix = link ? `\n\n${link}` : "";
  const budget = X_LIMIT - (link ? URL_WEIGHT + 2 : 0);
  if (xLength(clean) <= budget) return clean + suffix;
  const chars = [...clean];
  let out = "";
  for (const ch of chars) {
    if (xLength(out + ch) > budget - 1) break;
    out += ch;
  }
  const sp = out.lastIndexOf(" ");
  if (sp > out.length * 0.6) out = out.slice(0, sp);
  return out.replace(/[\s,.;:–—-]+$/, "") + "…" + suffix;
}
