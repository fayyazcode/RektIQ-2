import { NextResponse } from "next/server";
import { runDailyPosts } from "@/lib/jobs/daily-posts";
import { closeDb } from "@/lib/db";
import { authorized, rejectMethod, unauthorized } from "../guard";

export const dynamic = "force-dynamic";

/** Vercel Cron version of `npm run job:posts` (see the `crons` list in vercel.json). */
export async function GET(req: Request) {
  if (!authorized(req)) return unauthorized();
  try {
    const r = await runDailyPosts({ trigger: "schedule" });
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  } finally {
    await closeDb().catch(() => {});
  }
}

export async function POST() {
  return rejectMethod();
}
