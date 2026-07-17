import { NextResponse } from "next/server";
import { refreshAllActiveWeeks } from "@/lib/sync";

/**
 * GET /api/cron/sync?secret=CRON_SECRET
 *
 * Intended to be hit on a schedule (see vercel.json / your external cron
 * service) rather than by users. This only refreshes scores on games that
 * already exist — it deliberately does NOT re-sync/re-filter a week's
 * matchups (that's owner-only, via POST /api/leagues/:id/sync), so an
 * automated background job can never change what people have already
 * picked against.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get("secret") !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await refreshAllActiveWeeks();
  return NextResponse.json(result);
}
