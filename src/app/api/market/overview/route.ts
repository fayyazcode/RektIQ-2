import { NextResponse } from "next/server";
import { getOverview } from "@/lib/data/intel-queries";
import { parseMarketOverviewQuery } from "@/lib/api/validation";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const { symbols } = parseMarketOverviewQuery(searchParams);
    const data = await getOverview(symbols.length ? symbols : undefined);
    return NextResponse.json(data, {
      headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=30" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("invalid")) return NextResponse.json({ ok: false, error: msg }, { status: 400 });
    return NextResponse.json({ ok: false, error: "internal error" }, { status: 500 });
  }
}
