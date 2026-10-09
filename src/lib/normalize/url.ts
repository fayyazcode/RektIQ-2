import { createHash } from "node:crypto";

const TRACKING_PARAMS = /^(utm_[a-z]+|fbclid|gclid|mc_cid|mc_eid|ref|ref_src|source|cmpid|mod|taid|guccounter|_ga|s_kwcid|ocid)$/i;

/**
 * Canonical form of an article URL, so the same article reached via different
 * feeds or tracking links compares equal:
 * https, no www, lowercase host, no tracking params, no fragment, no trailing slash, no /amp.
 */
export function canonicalizeUrl(input: string): string | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  u.protocol = "https:";
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
  u.hash = "";
  u.port = "";
  for (const key of [...u.searchParams.keys()]) if (TRACKING_PARAMS.test(key)) u.searchParams.delete(key);
  u.searchParams.sort();
  let path = u.pathname.replace(/\/{2,}/g, "/");
  path = path.replace(/\/amp\/?$/, "");
  if (path.length > 1) path = path.replace(/\/+$/, "");
  u.pathname = path || "/";
  return u.toString().replace(/\?$/, "");
}

export const sha1 = (s: string) => createHash("sha1").update(s).digest("hex");
