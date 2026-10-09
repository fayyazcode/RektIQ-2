import { NextResponse } from "next/server";
import { getProviderHealthList } from "@/lib/data/intel-queries";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const health = await getProviderHealthList();
    return NextResponse.json({ health }, {
      headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=30" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}