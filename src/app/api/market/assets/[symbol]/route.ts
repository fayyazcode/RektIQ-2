import { NextResponse } from "next/server";
import { getAssetDetail } from "@/lib/data/intel-queries";
import { isValidSymbol } from "@/lib/realtime/protocol";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await ctx.params;
  const upper = symbol.toUpperCase();
  if (!isValidSymbol(upper)) return NextResponse.json({ ok: false, error: "invalid symbol" }, { status: 400 });
  const data = await getAssetDetail(upper);
  if (!data.asset) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  return NextResponse.json(data, {
    headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=30" },
  });
}
