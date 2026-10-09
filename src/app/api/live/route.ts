import { NextResponse } from "next/server";
import { countStoriesSince } from "@/lib/data/queries";

export const dynamic = "force-dynamic";

/** New-story counter for the live banner. Cached at the CDN for 30 s. */
export async function GET(req: Request) {
  const since = new Date(new URL(req.url).searchParams.get("since") ?? "");
  if (isNaN(since.getTime()) || Date.now() - since.getTime() > 7 * 86400_000) {
    return NextResponse.json({ count: 0 }, { status: 400 });
  }
  // Round to the minute so CDN caching works across visitors
  since.setUTCSeconds(0, 0);
  const count = await countStoriesSince(since.toISOString());
  return NextResponse.json({ count }, { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" } });
}
