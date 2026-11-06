import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * DELETE /api/leagues/:id/members/:userId
 *
 * - A member can remove themselves (leave the league).
 * - The owner can remove any other member.
 * - The owner cannot be removed this way — they must delete the league
 *   instead (DELETE /api/leagues/:id), which avoids leaving a league
 *   ownerless.
 */
export async function DELETE(_req: Request, { params }: { params: { id: string; userId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const requesterId = (session.user as any).id as string;

  const requesterMembership = await prisma.leagueMember.findUnique({
    where: { userId_leagueId: { userId: requesterId, leagueId: params.id } },
  });
  if (!requesterMembership) return NextResponse.json({ error: "Not a member of this league" }, { status: 403 });

  const targetMembership = await prisma.leagueMember.findUnique({
    where: { userId_leagueId: { userId: params.userId, leagueId: params.id } },
  });
  if (!targetMembership) return NextResponse.json({ error: "That user isn't in this league" }, { status: 404 });

  const isSelf = requesterId === params.userId;
  const isOwner = requesterMembership.role === "owner";

  if (targetMembership.role === "owner") {
    return NextResponse.json({ error: "The owner can't be removed — delete the league instead" }, { status: 400 });
  }
  if (!isSelf && !isOwner) {
    return NextResponse.json({ error: "Only the league owner can remove other members" }, { status: 403 });
  }

  await prisma.leagueMember.delete({ where: { userId_leagueId: { userId: params.userId, leagueId: params.id } } });
  return NextResponse.json({ removed: true });
}
