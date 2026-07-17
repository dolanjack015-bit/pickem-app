import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const SEASON_TYPE_LABEL: Record<number, string> = { 1: "Week 0/Pre", 2: "Reg", 3: "Post" };

/**
 * GET /api/leagues/:id/picks?userId=<id>&sport=NFL|CFB|FANTASY|ALL
 *
 * A full pick history — every pick that user has made in this league,
 * newest first, with the matchup and result attached. `userId` defaults
 * to the requester's own picks. Looking up someone else's history only
 * returns picks on games that have already started (same reveal rule as
 * the week view), so nobody can browse a teammate's future picks early.
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const requesterId = (session.user as any).id as string;

  const requesterMembership = await prisma.leagueMember.findUnique({
    where: { userId_leagueId: { userId: requesterId, leagueId: params.id } },
  });
  if (!requesterMembership) return NextResponse.json({ error: "Not a member of this league" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const targetUserId = searchParams.get("userId") || requesterId;
  const sport = searchParams.get("sport")?.toUpperCase();

  const targetMembership = await prisma.leagueMember.findUnique({
    where: { userId_leagueId: { userId: targetUserId, leagueId: params.id } },
  });
  if (!targetMembership) return NextResponse.json({ error: "That user isn't in this league" }, { status: 404 });

  const gameWhere: any = { week: { leagueId: params.id } };
  if (sport && sport !== "ALL") gameWhere.week.sport = sport;

  const picks = await prisma.pick.findMany({
    where: { userId: targetUserId, game: gameWhere },
    include: { game: { include: { week: true } } },
    orderBy: { game: { startTime: "desc" } },
  });

  const isSelf = targetUserId === requesterId;
  const now = Date.now();

  const rows = picks
    .filter((p) => isSelf || p.game.status !== "scheduled" || new Date(p.game.startTime).getTime() <= now)
    .map((p) => {
      const week = p.game.week;
      const weekLabel =
        week.sport === "FANTASY"
          ? `Fantasy Week ${week.weekNumber}`
          : `${week.sport} ${week.season} ${SEASON_TYPE_LABEL[week.seasonType] ?? ""} Wk ${week.weekNumber}`;
      const pickedTeamName = p.pickedTeam === "home" ? p.game.homeTeam : p.game.awayTeam;
      return {
        gameId: p.gameId,
        weekLabel,
        sport: week.sport,
        gameLabel: p.game.gameLabel,
        homeTeam: p.game.homeTeam,
        awayTeam: p.game.awayTeam,
        homeScore: p.game.homeScore,
        awayScore: p.game.awayScore,
        pickedTeam: p.pickedTeam,
        pickedTeamName,
        isCorrect: p.isCorrect,
        status: p.game.status,
        startTime: p.game.startTime,
      };
    });

  return NextResponse.json(rows);
}
