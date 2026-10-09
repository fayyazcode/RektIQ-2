import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { GenerateRequestSchema, generateForRef } from "@/lib/social/xgen";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const parsed = GenerateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "invalid request", issues: parsed.error.flatten() }, { status: 400 });
  }

  const { refType, refId } = parsed.data;
  const result = await generateForRef(refType, refId);
  if ("error" in result) return NextResponse.json({ ok: false, error: result.error }, { status: 404 });
  return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
}
