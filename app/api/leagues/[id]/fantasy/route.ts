import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";

/**
 * POST /api/leagues/:id/fantasy
 * body: { season, weekNumber, homeTeam, awayTeam, startTime? }
 *
 * Creates (or gets-or-creates the Week for) a hand-entered fantasy
 * matchup. Owner-only, same as ESPN-sourced syncing — the owner sets
 * what's up for picks each week.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (session.user as any).id as string;

  const membership = await prisma.leagueMember.findUnique({
    where: { userId_leagueId: { userId, leagueId: params.id } },
  });
  if (!membership) return NextResponse.json({ error: "Not a member of this league" }, { status: 403 });
  if (membership.role !== "owner") {
    return NextResponse.json({ error: "Only the league owner can add fantasy matchups" }, { status: 403 });
  }

  const { season, weekNumber, homeTeam, awayTeam, startTime } = await req.json();
  if (!season || weekNumber === undefined || !homeTeam || !awayTeam) {
    return NextResponse.json({ error: "season, weekNumber, homeTeam, and awayTeam are required" }, { status: 400 });
  }

  const week = await prisma.week.upsert({
    where: {
      leagueId_season_weekNumber_seasonType_sport: {
        leagueId: params.id,
        season,
        weekNumber,
        seasonType: 2,
        sport: "FANTASY",
      },
    },
    update: {},
    create: { leagueId: params.id, season, weekNumber, seasonType: 2, sport: "FANTASY" },
  });

  const game = await prisma.game.create({
    data: {
      weekId: week.id,
      espnEventId: `manual-${crypto.randomUUID()}`,
      homeTeam,
      awayTeam,
      homeTeamAbbr: homeTeam.slice(0, 12),
      awayTeamAbbr: awayTeam.slice(0, 12),
      startTime: startTime ? new Date(startTime) : new Date(),
      status: "scheduled",
      isManual: true,
    },
  });

  return NextResponse.json(game);
}
