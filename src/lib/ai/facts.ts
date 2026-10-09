import { normalizeNumbers } from "../dedupe/similarity";

/**
 * Anti-invention check for AI text: every significant number in the output (amounts,
 * percentages, prices, anything above 10) must appear in the source material.
 * "$900M", "$900 million" and "900m" all count as the same number.
 */
export function numbersIn(text: string): string[] {
  const norm = normalizeNumbers(text.toLowerCase().replace(/,(?=\d{3}\b)/g, ""));
  const out = new Set<string>();
  for (const m of norm.matchAll(/(\d+(?:\.\d+)?)([kmbt%])?/g)) {
    const value = Number(m[1]);
    const unit = m[2] ?? "";
    if (!unit && value <= 10) continue; // "3 newsrooms", "2 hours": small counts are fine
    out.add(`${Number(value.toFixed(4))}${unit}`);
  }
  return [...out];
}

export function unknownNumbers(output: string, sources: string[]): string[] {
  const known = new Set(sources.flatMap(numbersIn));
  const year = new Date().getUTCFullYear();
  return numbersIn(output).filter((n) => !known.has(n) && !(/^\d{4}$/.test(n) && Math.abs(Number(n) - year) <= 1));
}

/** Stories where a joke would be in poor taste: people lost money, freedom or worse. */
export const SENSITIVE =
  /\b(hack(ed|s)?|exploit(ed|s)?|stolen|steal\w*|drain(ed|er)?|scam\w*|fraud\w*|ponzi|rug ?pull\w*|bankrupt\w*|insolven\w*|arrest\w*|charged|sentenc\w*|prison|jail\w*|indict\w*|lawsuit|sue[sd]?|death|dead|died|dies|killed|kidnap\w*|victims?|layoffs?|laid off|suicide|war|attack\w*|liquidat\w*|lost savings|phishing|ransom\w*)\b/i;

export const isSensitive = (...texts: string[]) => SENSITIVE.test(texts.join(" "));
