import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * TEMPORARY DIAGNOSTIC ROUTE — read-only, no writes.
 * GET /api/leagues/:id/debug-scores
 *
 * Dumps every NFL/CFB week in this league and every game in it, exactly as
 * currently stored in the database (status, scores, winner, espnEventId,
 * startTime). No ESPN calls, no mutations — just what's actually saved.
 * Safe to delete once the refresh-scores bug is tracked down.
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (session.user as any).id as string;

  const membership = await prisma.leagueMember.findUnique({
    where: { userId_leagueId: { userId, leagueId: params.id } },
  });
  if (!membership) return NextResponse.json({ error: "Not a member of this league" }, { status: 403 });

  const weeks = await prisma.week.findMany({
    where: { leagueId: params.id, sport: { in: ["NFL", "CFB"] } },
    orderBy: [{ sport: "asc" }, { seasonType: "asc" }, { weekNumber: "asc" }],
    include: {
      games: {
        orderBy: { startTime: "asc" },
        select: {
          id: true,
          espnEventId: true,
          homeTeam: true,
          awayTeam: true,
          startTime: true,
          status: true,
          homeScore: true,
          awayScore: true,
          winner: true,
          isManual: true,
        },
      },
    },
  });

  const result = weeks.map((w) => ({
    weekId: w.id,
    sport: w.sport,
    season: w.season,
    weekNumber: w.weekNumber,
    seasonType: w.seasonType,
    picksLockAt: w.picksLockAt,
    games: w.games.map((g) => ({
      gameId: g.id,
      matchup: `${g.awayTeam} @ ${g.homeTeam}`,
      startTime: g.startTime,
      espnEventId: g.espnEventId,
      status: g.status,
      homeScore: g.homeScore,
      awayScore: g.awayScore,
      winner: g.winner,
      isManual: g.isManual,
    })),
  }));

  return NextResponse.json(result, { status: 200 });
}
