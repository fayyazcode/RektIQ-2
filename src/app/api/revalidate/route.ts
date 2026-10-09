import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { NEWS_TAG } from "@/lib/data/queries";
import { secret } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Called by the GitHub Actions jobs after they write, so new stories appear immediately. */
export async function POST(req: Request) {
  const expected = secret("REVALIDATE_SECRET");
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!expected || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  revalidateTag(NEWS_TAG, { expire: 0 });
  return NextResponse.json({ ok: true, revalidated: NEWS_TAG });
}
