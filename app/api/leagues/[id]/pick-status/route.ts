import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/leagues/:id/pick-status?sport=&season=&weekNumber=&seasonType=
 *
 * Owner-only. Shows, for every member and every game in the given week,
 * whether they've submitted a pick — a completion checklist, not a leak
 * of what anyone actually picked. Useful for the owner to confirm
 * everyone's picks are in (and saved) before a week locks, without
 * spoiling anyone's actual choices.
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (session.user as any).id as string;

  const membership = await prisma.leagueMember.findUnique({
    where: { userId_leagueId: { userId, leagueId: params.id } },
  });
  if (!membership) return NextResponse.json({ error: "Not a member of this league" }, { status: 403 });
  if (membership.role !== "owner") {
    return NextResponse.json({ error: "Only the league owner can view pick completion status" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const sport = searchParams.get("sport");
  const season = Number(searchParams.get("season"));
  const weekNumber = Number(searchParams.get("weekNumber"));
  const seasonType = Number(searchParams.get("seasonType") ?? "2");
  if (!sport || !season || (!weekNumber && weekNumber !== 0)) {
    return NextResponse.json({ error: "sport, season, and weekNumber query params are required" }, { status: 400 });
  }

  const week = await prisma.week.findUnique({
    where: { leagueId_season_weekNumber_seasonType_sport: { leagueId: params.id, season, weekNumber, seasonType, sport } },
    include: {
      games: {
        orderBy: { startTime: "asc" },
        // Deliberately not selecting pickedTeam anywhere in this route —
        // only whether a Pick row exists for a given user+game.
        include: { picks: { select: { userId: true, gameId: true } } },
      },
    },
  });

  if (!week) return NextResponse.json({ games: [], members: [] });

  const members = await prisma.leagueMember.findMany({
    where: { leagueId: params.id },
    include: { user: { select: { id: true, username: true } } },
    orderBy: { joinedAt: "asc" },
  });

  const games = week.games.map((g) => ({
    id: g.id,
    label: `${g.awayTeamAbbr} @ ${g.homeTeamAbbr}`,
    gameLabel: g.gameLabel,
  }));

  const memberRows = members.map((m) => {
    const pickedGameIds = new Set(
      week.games.filter((g) => g.picks.some((p) => p.userId === m.userId)).map((g) => g.id)
    );
    return {
      userId: m.userId,
      username: m.user.username,
      picked: games.map((g) => pickedGameIds.has(g.id)),
      totalPicked: pickedGameIds.size,
      totalGames: games.length,
    };
  });

  return NextResponse.json({ games, members: memberRows });
}
