import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (session.user as any).id as string;

  const membership = await prisma.leagueMember.findUnique({
    where: { userId_leagueId: { userId, leagueId: params.id } },
    include: { league: true },
  });
  if (!membership) return NextResponse.json({ error: "Not a member of this league" }, { status: 403 });

  return NextResponse.json({ ...membership.league, role: membership.role });
}

/** DELETE /api/leagues/:id — owner only. Cascades to members, weeks, games, and picks. */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (session.user as any).id as string;

  const league = await prisma.league.findUnique({ where: { id: params.id } });
  if (!league) return NextResponse.json({ error: "League not found" }, { status: 404 });
  if (league.ownerId !== userId) {
    return NextResponse.json({ error: "Only the league owner can delete the league" }, { status: 403 });
  }

  await prisma.league.delete({ where: { id: params.id } });
  return NextResponse.json({ deleted: true });
}
