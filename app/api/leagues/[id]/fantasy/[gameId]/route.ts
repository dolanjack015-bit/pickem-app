import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { gradeManualGame } from "@/lib/sync";

async function requireMembership(leagueId: string, userId: string) {
  return prisma.leagueMember.findUnique({ where: { userId_leagueId: { userId, leagueId } } });
}

/**
 * PATCH /api/leagues/:id/fantasy/:gameId
 * body: { homeScore, awayScore }
 * Sets the final score on a manual game and grades every pick tied to it.
 */
export async function PATCH(req: Request, { params }: { params: { id: string; gameId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (session.user as any).id as string;

  const membership = await requireMembership(params.id, userId);
  if (!membership) return NextResponse.json({ error: "Not a member of this league" }, { status: 403 });

  const game = await prisma.game.findUnique({ where: { id: params.gameId }, include: { week: true } });
  if (!game || game.week.leagueId !== params.id || !game.isManual) {
    return NextResponse.json({ error: "Manual game not found in this league" }, { status: 404 });
  }

  const { homeScore, awayScore } = await req.json();
  if (typeof homeScore !== "number" || typeof awayScore !== "number") {
    return NextResponse.json({ error: "homeScore and awayScore must be numbers" }, { status: 400 });
  }

  const result = await gradeManualGame(params.gameId, homeScore, awayScore);
  return NextResponse.json(result);
}

/** DELETE /api/leagues/:id/fantasy/:gameId — remove a manual matchup (and its picks). */
export async function DELETE(_req: Request, { params }: { params: { id: string; gameId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (session.user as any).id as string;

  const membership = await requireMembership(params.id, userId);
  if (!membership) return NextResponse.json({ error: "Not a member of this league" }, { status: 403 });

  const game = await prisma.game.findUnique({ where: { id: params.gameId }, include: { week: true } });
  if (!game || game.week.leagueId !== params.id || !game.isManual) {
    return NextResponse.json({ error: "Manual game not found in this league" }, { status: 404 });
  }

  await prisma.game.delete({ where: { id: params.gameId } });
  return NextResponse.json({ deleted: true });
}
