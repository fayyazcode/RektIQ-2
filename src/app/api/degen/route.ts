import { NextResponse } from "next/server";
import { getDegenRadar } from "@/lib/data/intel-queries";
import { parseDegenQuery } from "@/lib/api/validation";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const { maxMarketCap } = parseDegenQuery(searchParams);
    const rows = await getDegenRadar(maxMarketCap);
    return NextResponse.json(
      {
        rows,
        maxMarketCap,
        disclaimer: "High turnover small caps are volatile. Not investment advice.",
      },
      { headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=30" } }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("invalid")) return NextResponse.json({ ok: false, error: msg }, { status: 400 });
    return NextResponse.json({ ok: false, error: "internal error" }, { status: 500 });
  }
}
