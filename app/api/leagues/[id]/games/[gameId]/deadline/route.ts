import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * PATCH /api/leagues/:id/games/:gameId/deadline
 * body: { deadline: string | null }
 *
 * Owner-only. Sets a custom pick deadline for this one game, overriding
 * the normal week-wide (or per-game, for fantasy) lock — used to reopen
 * picks for someone who missed the original deadline, or to fix a
 * mistaken date without touching the week's other games. Pass
 * `deadline: null` to clear the override and go back to the normal lock.
 *
 * This only ever changes when NEW or CHANGED picks are accepted — it
 * never deletes or alters any pick that's already been saved.
 */
export async function PATCH(req: Request, { params }: { params: { id: string; gameId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (session.user as any).id as string;

  const membership = await prisma.leagueMember.findUnique({
    where: { userId_leagueId: { userId, leagueId: params.id } },
  });
  if (!membership) return NextResponse.json({ error: "Not a member of this league" }, { status: 403 });
  if (membership.role !== "owner") {
    return NextResponse.json({ error: "Only the league owner can change a pick deadline" }, { status: 403 });
  }

  const game = await prisma.game.findUnique({ where: { id: params.gameId }, include: { week: true } });
  if (!game || game.week.leagueId !== params.id) {
    return NextResponse.json({ error: "Game not found in this league" }, { status: 404 });
  }

  const { deadline } = await req.json();
  if (deadline !== null && isNaN(new Date(deadline).getTime())) {
    return NextResponse.json({ error: "deadline must be a valid date/time, or null to clear the override" }, { status: 400 });
  }

  const updated = await prisma.game.update({
    where: { id: params.gameId },
    data: { pickDeadlineOverride: deadline === null ? null : new Date(deadline) },
  });

  return NextResponse.json({ pickDeadlineOverride: updated.pickDeadlineOverride });
}
