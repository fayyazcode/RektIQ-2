import { secret } from "./env";
/** Tells the website to drop its cached news after a job wrote new data. Never throws. */
export async function notifySite(): Promise<string> {
  const url = process.env.NEXT_PUBLIC_SITE_URL;
  const token = secret("REVALIDATE_SECRET");
  if (!url || !token || url.includes("localhost")) return "site cache not notified (set NEXT_PUBLIC_SITE_URL and REVALIDATE_SECRET)";
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/api/revalidate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    return res.ok ? "site cache refreshed" : `site cache refresh failed: HTTP ${res.status}`;
  } catch (err) {
    return `site cache refresh failed: ${err instanceof Error ? err.message : err}`;
  }
}
