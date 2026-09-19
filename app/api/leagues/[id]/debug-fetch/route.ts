import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fetchScoreboardByDate } from "@/lib/espn";

/**
 * TEMPORARY DIAGNOSTIC ROUTE — read-only, no writes.
 * GET /api/leagues/:id/debug-fetch?weekId=xxx
 *
 * Calls the exact same ESPN fetch that refreshWeekScores uses for this
 * week (same date-range calculation, same function), but instead of
 * silently swallowing a failure, it reports the real error message and
 * the raw list of games ESPN actually returned. Safe to delete once the
 * refresh-scores bug is tracked down.
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (session.user as any).id as string;

  const membership = await prisma.leagueMember.findUnique({
    where: { userId_leagueId: { userId, leagueId: params.id } },
  });
  if (!membership) return NextResponse.json({ error: "Not a member of this league" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const weekId = searchParams.get("weekId");
  if (!weekId) return NextResponse.json({ error: "weekId query param is required" }, { status: 400 });

  const week = await prisma.week.findUnique({ where: { id: weekId }, include: { games: true } });
  if (!week || week.leagueId !== params.id) {
    return NextResponse.json({ error: "Week not found in this league" }, { status: 404 });
  }

  const times = week.games.map((g) => new Date(g.startTime).getTime());
  const minDate = new Date(Math.min(...times) - 24 * 60 * 60 * 1000);
  const maxDate = new Date(Math.max(...times) + 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
  const dateRange = `${fmt(minDate)}-${fmt(maxDate)}`;

  try {
    const fetched = await fetchScoreboardByDate(week.sport as "NFL" | "CFB", dateRange);
    return NextResponse.json({
      ok: true,
      sport: week.sport,
      dateRangeUsed: dateRange,
      espnGamesReturned: fetched.length,
      espnGames: fetched.map((g) => ({
        espnEventId: g.espnEventId,
        matchup: `${g.awayTeam} @ ${g.homeTeam}`,
        startTime: g.startTime,
        status: g.status,
        winner: g.winner,
      })),
      dbGamesInWeek: week.games.map((g) => ({ espnEventId: g.espnEventId, matchup: `${g.awayTeam} @ ${g.homeTeam}`, status: g.status })),
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        sport: week.sport,
        dateRangeUsed: dateRange,
        error: err?.message ?? "Unknown error",
        errorString: String(err),
      },
      { status: 200 }
    );
  }
}
