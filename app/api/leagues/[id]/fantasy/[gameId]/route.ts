import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { gradeManualGame } from "@/lib/sync";

async function requireOwner(leagueId: string, userId: string) {
  const membership = await prisma.leagueMember.findUnique({ where: { userId_leagueId: { userId, leagueId } } });
  if (!membership) return { error: NextResponse.json({ error: "Not a member of this league" }, { status: 403 }) };
  if (membership.role !== "owner") {
    return { error: NextResponse.json({ error: "Only the league owner can manage fantasy matchups" }, { status: 403 }) };
  }
  return { membership };
}

/**
 * PATCH /api/leagues/:id/fantasy/:gameId
 * body: { homeScore, awayScore }
 * Sets the final score on a manual game and grades every pick tied to it.
 * Owner-only.
 */
export async function PATCH(req: Request, { params }: { params: { id: string; gameId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (session.user as any).id as string;

  const { error } = await requireOwner(params.id, userId);
  if (error) return error;

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

/** DELETE /api/leagues/:id/fantasy/:gameId — remove a manual matchup (and its picks). Owner-only. */
export async function DELETE(_req: Request, { params }: { params: { id: string; gameId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (session.user as any).id as string;

  const { error } = await requireOwner(params.id, userId);
  if (error) return error;

  const game = await prisma.game.findUnique({ where: { id: params.gameId }, include: { week: true } });
  if (!game || game.week.leagueId !== params.id || !game.isManual) {
    return NextResponse.json({ error: "Manual game not found in this league" }, { status: 404 });
  }

  await prisma.game.delete({ where: { id: params.gameId } });
  return NextResponse.json({ deleted: true });
}
