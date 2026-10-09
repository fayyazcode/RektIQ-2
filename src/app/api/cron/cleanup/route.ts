import { NextResponse } from "next/server";
import { runCleanup } from "@/lib/jobs/cleanup";
import { closeDb } from "@/lib/db";
import { authorized, rejectMethod, unauthorized } from "../guard";

export const dynamic = "force-dynamic";

/** Vercel Cron version of `npm run job:cleanup` (see the `crons` list in vercel.json). */
export async function GET(req: Request) {
  if (!authorized(req)) return unauthorized();
  try {
    const r = await runCleanup("schedule");
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
