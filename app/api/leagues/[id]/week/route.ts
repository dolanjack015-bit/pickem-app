import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (session.user as any).id as string;

  const membership = await prisma.leagueMember.findUnique({
    where: { userId_leagueId: { userId, leagueId: params.id } },
  });
  if (!membership) return NextResponse.json({ error: "Not a member of this league" }, { status: 403 });

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
        include: { picks: { include: { user: { select: { id: true, username: true } } } } },
      },
    },
  });

  if (!week) return NextResponse.json({ games: [] });

  const now = Date.now();
  const weekLocked = week.sport !== "FANTASY" && !!week.picksLockAt && new Date(week.picksLockAt).getTime() <= now;
  const games = week.games.map((game) => {
    const started =
      week.sport === "FANTASY"
        ? new Date(game.startTime).getTime() <= now || game.status !== "scheduled"
        : weekLocked || game.status !== "scheduled";
    return {
      id: game.id,
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      homeTeamAbbr: game.homeTeamAbbr,
      awayTeamAbbr: game.awayTeamAbbr,
      startTime: game.startTime,
      status: game.status,
      homeScore: game.homeScore,
      awayScore: game.awayScore,
      winner: game.winner,
      homeLogo: game.homeLogo,
      awayLogo: game.awayLogo,
      homeLogoThrowback: game.homeLogoThrowback,
      awayLogoThrowback: game.awayLogoThrowback,
      homeRecord: game.homeRecord,
      awayRecord: game.awayRecord,
      homeRank: game.homeRank,
      awayRank: game.awayRank,
      gameLabel: game.gameLabel,
      isManual: game.isManual,
      locked: week.sport === "FANTASY" ? started : weekLocked,
      myPick: game.picks.find((p) => p.userId === userId)?.pickedTeam ?? null,
      picks: started
        ? game.picks.map((p) => ({ username: p.user.username, pickedTeam: p.pickedTeam, isCorrect: p.isCorrect }))
        : game.picks
            .filter((p) => p.userId === userId)
            .map((p) => ({ username: p.user.username, pickedTeam: p.pickedTeam, isCorrect: p.isCorrect })),
    };
  });

  return NextResponse.json({ weekId: week.id, picksLockAt: week.picksLockAt, locked: weekLocked, games });
}
