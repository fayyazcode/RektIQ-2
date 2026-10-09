import { NextResponse } from "next/server";
import { getHistory, getMarketBatch } from "@/lib/market/service";
import { TIMEFRAMES, type Timeframe } from "@/lib/market/types";
import { isValidSymbol } from "@/lib/realtime/protocol";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await ctx.params;
  const upper = symbol.toUpperCase();
  if (!isValidSymbol(upper)) return NextResponse.json({ error: "Invalid symbol" }, { status: 400 });

  const rawTimeframe = new URL(req.url).searchParams.get("timeframe") ?? "24h";
  if (!TIMEFRAMES.includes(rawTimeframe as Timeframe)) {
    return NextResponse.json({ error: "Unsupported chart timeframe" }, { status: 400 });
  }

  const timeframe = rawTimeframe as Timeframe;
  const [result, batch] = await Promise.all([getHistory(upper, timeframe), getMarketBatch([upper])]);
  const asset = batch.assets.find((row) => row.symbol === upper);
  return NextResponse.json(
    {
      symbol: upper,
      timeframe,
      points: result.points,
      stale: result.stale || batch.stale,
      error: result.error ?? batch.error ?? null,
      checkedAt: new Date().toISOString(),
      quote: asset ? { t: asset.timestamp, price: asset.price, stale: batch.stale } : null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
