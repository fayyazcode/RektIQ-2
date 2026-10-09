import { NextResponse } from "next/server";
import { listSignals } from "@/lib/data/intel-queries";
import { parseListQuery } from "@/lib/api/validation";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  try {
    const { symbol } = await ctx.params;
    const { searchParams } = new URL(req.url);
    searchParams.set("symbol", symbol);
    const opts = parseListQuery(searchParams);
    const signals = await listSignals(opts);
    return NextResponse.json({ signals }, {
      headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=30" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("invalid")) return NextResponse.json({ ok: false, error: msg }, { status: 400 });
    return NextResponse.json({ ok: false, error: "internal error" }, { status: 500 });
  }
}
