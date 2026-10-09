import { NextResponse } from "next/server";
import { listNewsImpacts } from "@/lib/data/intel-queries";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[a-f0-9]{24}$/i.test(id)) return NextResponse.json({ ok: false, error: "invalid id" }, { status: 400 });
  const impacts = await listNewsImpacts({ id });
  if (!impacts.length) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  return NextResponse.json({ impact: impacts[0] }, {
    headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" },
  });
}
