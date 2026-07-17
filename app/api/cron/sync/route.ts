import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncWeek } from "@/lib/sync";

/**
 * GET /api/cron/sync?secret=CRON_SECRET
 *
 * Intended to be hit on a schedule (see vercel.json) rather than by users.
 * Re-syncs every Week that has at least one non-final game, so scores and
 * pick grading stay current without anyone manually clicking "Sync".
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get("secret") !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const activeWeeks = await prisma.week.findMany({
    where: { games: { some: { status: { not: "final" } } } },
  });

  const results = [];
  for (const week of activeWeeks) {
    try {
      const result = await syncWeek(
        week.leagueId,
        week.sport as "NFL" | "CFB",
        week.season,
        week.weekNumber,
        week.seasonType
      );
      results.push({ weekId: week.id, ...result });
    } catch (err: any) {
      results.push({ weekId: week.id, error: err.message });
    }
  }

  return NextResponse.json({ weeksSynced: results.length, results });
}
