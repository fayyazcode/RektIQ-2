const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "'", lsquo: "'",
  rdquo: '"', ldquo: '"', hellip: "…", mdash: "—", ndash: "–", laquo: "«", raquo: "»", euro: "€", pound: "£",
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => safeCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => safeCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n: string) => NAMED[n.toLowerCase()] ?? m);
}

function safeCodePoint(n: number) {
  try {
    return String.fromCodePoint(n);
  } catch {
    return "";
  }
}

export function stripHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|figure|iframe|noscript)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<\/(p|div|li|h\d)>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  );
}

/** Unicode + whitespace + typography normalization */
export function cleanText(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[\u2018\u2019\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201F\u2033]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** Publisher boilerplate that some feeds append to every summary. */
const BOILERPLATE = [
  /The post .{3,300}? appeared first on .{2,80}?\.?$/i,
  /(Read|Continue reading) (more|the full (story|article)).*$/i,
  /\[…\]|\[\.\.\.\]$/,
  /This article (was )?originally (appeared|published) (on|in) .*$/i,
];

export function cleanSummary(raw: string, max = 600): string {
  let s = cleanText(stripHtml(raw));
  for (const re of BOILERPLATE) s = s.replace(re, "").trim();
  return truncate(s, max);
}

/** Removes " - CoinDesk", " | Decrypt" style suffixes and repeated whitespace from titles. */
export function cleanTitle(raw: string, sourceName?: string): string {
  let t = cleanText(stripHtml(raw));
  if (sourceName) {
    const escaped = sourceName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    t = t.replace(new RegExp(`\\s*[-|–—:]\\s*${escaped}\\s*$`, "i"), "");
  }
  return t.replace(/^(breaking|just in|update)\s*[:\-–—]\s*/i, "").trim();
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,.;:–—-]+$/, "") + "…";
}

/** Lowercase, accent-free, punctuation-free key for exact title comparison. */
export function titleKey(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9$%.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function slugify(title: string, suffix: string): string {
  const base = titleKey(title).replace(/[$%.]/g, "").trim().replace(/\s+/g, "-").slice(0, 80).replace(/-+$/, "");
  return `${base || "story"}-${suffix}`;
}
