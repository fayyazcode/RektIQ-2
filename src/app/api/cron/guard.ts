import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { secret } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Shared guard for the Vercel Cron endpoints listed in vercel.json.
 * Vercel sends `Authorization: Bearer <CRON_SECRET>` automatically when a
 * project-level CRON_SECRET is set; REVALIDATE_SECRET is also accepted so an
 * existing secret can be reused without extra configuration.
 */
export function authorized(req: Request): boolean {
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!given) return false;
  return [secret("CRON_SECRET"), secret("REVALIDATE_SECRET")]
    .filter((expected): expected is string => !!expected)
    .some((expected) => {
      const a = Buffer.from(given);
      const b = Buffer.from(expected);
      return a.length === b.length && timingSafeEqual(a, b);
    });
}

/** Vercel crons call these endpoints with GET; anything else is rejected. */
export function rejectMethod() {
  return NextResponse.json({ ok: false, error: "method not allowed" }, { status: 405 });
}

export function unauthorized() {
  return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
}
