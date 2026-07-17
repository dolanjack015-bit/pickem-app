import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * DELETE /api/leagues/:id/games/:gameId
 *
 * Owner-only. Removes a single game (and every pick tied to it) from the
 * board, regardless of whether it was ESPN-synced or manually entered.
 * This is the direct escape hatch for "this game shouldn't be here" —
 * useful for cleaning up stray/mis-synced games without waiting on a
 * full re-sync to sort itself out.
 */
export async function DELETE(_req: Request, { params }: { params: { id: string; gameId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (session.user as any).id as string;

  const membership = await prisma.leagueMember.findUnique({
    where: { userId_leagueId: { userId, leagueId: params.id } },
  });
  if (!membership) return NextResponse.json({ error: "Not a member of this league" }, { status: 403 });
  if (membership.role !== "owner") {
    return NextResponse.json({ error: "Only the league owner can remove a game" }, { status: 403 });
  }

  const game = await prisma.game.findUnique({ where: { id: params.gameId }, include: { week: true } });
  if (!game || game.week.leagueId !== params.id) {
    return NextResponse.json({ error: "Game not found in this league" }, { status: 404 });
  }

  await prisma.game.delete({ where: { id: params.gameId } });
  return NextResponse.json({ deleted: true });
}
