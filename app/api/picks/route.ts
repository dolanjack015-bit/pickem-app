import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (session.user as any).id as string;

  const { gameId, pickedTeam } = await req.json();
  if (!gameId || !["home", "away"].includes(pickedTeam)) {
    return NextResponse.json({ error: "gameId and pickedTeam ('home' | 'away') are required" }, { status: 400 });
  }

  const game = await prisma.game.findUnique({ where: { id: gameId }, include: { week: true } });
  if (!game) return NextResponse.json({ error: "Game not found" }, { status: 404 });

  const membership = await prisma.leagueMember.findUnique({
    where: { userId_leagueId: { userId, leagueId: game.week.leagueId } },
  });
  if (!membership) return NextResponse.json({ error: "Not a member of this league" }, { status: 403 });

  if (game.week.sport === "FANTASY") {
    if (game.status !== "scheduled" || new Date(game.startTime).getTime() <= Date.now()) {
      return NextResponse.json({ error: "Picks lock once this matchup's start time has passed" }, { status: 400 });
    }
  } else {
    // NFL/CFB: the whole week locks at once, at the earliest kickoff in
    // that week (normally Thursday Night Football) — not per-game.
    const lockAt = game.week.picksLockAt ?? game.startTime;
    if (new Date(lockAt).getTime() <= Date.now()) {
      return NextResponse.json({ error: "Picks for this week are locked — the week's first game has already kicked off" }, { status: 400 });
    }
  }

  const pick = await prisma.pick.upsert({
    where: { userId_gameId: { userId, gameId } },
    update: { pickedTeam },
    create: { userId, gameId, pickedTeam },
  });

  return NextResponse.json(pick);
}
