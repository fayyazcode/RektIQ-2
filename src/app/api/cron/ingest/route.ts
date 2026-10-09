import { NextResponse } from "next/server";
import { runIngest } from "@/lib/jobs/ingest";
import { runSummaries } from "@/lib/jobs/summaries";
import { runBreakingAlerts } from "@/lib/jobs/breaking";
import { closeDb } from "@/lib/db";
import { authorized, rejectMethod, unauthorized } from "../guard";

export const dynamic = "force-dynamic";

/**
 * Vercel Cron version of `npm run job:ingest` (see the `crons` list in vercel.json).
 * Runs the hourly news check, then summaries and the breaking-alert check — problems
 * in the follow-up steps never fail the ingest itself, mirroring scripts/ingest.ts.
 */
export async function GET(req: Request) {
  if (!authorized(req)) return unauthorized();
  try {
    const r = await runIngest("schedule");
    const summaries = await runSummaries("schedule").catch(
      (err: Error) => ({ status: "failed", message: `Summaries failed: ${err.message}` }),
    );
    const breaking = await runBreakingAlerts("schedule").catch(
      (err: Error) => ({ status: "failed", message: `Breaking alert check failed: ${err instanceof Error ? err.message : String(err)}` }),
    );
    return NextResponse.json({ ok: true, ...r, summaries, breaking });
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
