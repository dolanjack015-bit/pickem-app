import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/leagues/:id/leaderboard?sport=NFL|CFB|FANTASY|ALL
 *
 * `sport` defaults to ALL (every pick across every sport in the league,
 * combined). Pass NFL, CFB, or FANTASY to scope the standings to picks
 * made on games belonging to that sport's weeks only.
 *
 * Optionally scope to a single week — pass `season`, `weekNumber`, and
 * `seasonType` together — to get that week's standings only (i.e. "who
 * won this week"), instead of the season-long total. If that Week hasn't
 * been synced yet, returns an empty list rather than an error.
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
  const sport = searchParams.get("sport")?.toUpperCase() ?? "ALL";
  const seasonParam = searchParams.get("season");
  const weekNumberParam = searchParams.get("weekNumber");
  const seasonTypeParam = searchParams.get("seasonType");

  const members = await prisma.leagueMember.findMany({
    where: { leagueId: params.id },
    include: { user: { select: { id: true, username: true } } },
  });

  let gameWhere: any;

  if (seasonParam !== null && weekNumberParam !== null && seasonTypeParam !== null && sport !== "ALL") {
    // Weekly mode: scope to one specific Week.
    const week = await prisma.week.findUnique({
      where: {
        leagueId_season_weekNumber_seasonType_sport: {
          leagueId: params.id,
          season: Number(seasonParam),
          weekNumber: Number(weekNumberParam),
          seasonType: Number(seasonTypeParam),
          sport,
        },
      },
    });
    if (!week) return NextResponse.json([]); // not synced yet — nothing to show
    gameWhere = { weekId: week.id };
  } else {
    // Season-wide mode (existing behavior).
    gameWhere = sport === "ALL" ? { week: { leagueId: params.id } } : { week: { leagueId: params.id, sport } };
  }

  const rows = await Promise.all(
    members.map(async (m) => {
      const picks = await prisma.pick.findMany({
        where: { userId: m.userId, game: gameWhere },
        select: { isCorrect: true },
      });
      const correct = picks.filter((p) => p.isCorrect === true).length;
      const incorrect = picks.filter((p) => p.isCorrect === false).length;
      const graded = correct + incorrect;
      return {
        userId: m.userId,
        username: m.user.username,
        correct,
        incorrect,
        totalPicks: picks.length,
        winPct: graded > 0 ? Math.round((correct / graded) * 1000) / 10 : 0,
      };
    })
  );

  rows.sort((a, b) => b.correct - a.correct || b.winPct - a.winPct);

  return NextResponse.json(rows);
}
