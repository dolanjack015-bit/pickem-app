import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { refreshWeekScores } from "@/lib/sync";

/**
 * POST /api/leagues/:id/refresh-scores
 * body: { weekId }
 *
 * Any league member can call this — it only updates scores/status on
 * games that already exist in the week (and grades picks as games go
 * final). It can never add, remove, or re-filter which games are in the
 * week; only the owner's sync (POST /api/leagues/:id/sync) can do that.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (session.user as any).id as string;

  const membership = await prisma.leagueMember.findUnique({
    where: { userId_leagueId: { userId, leagueId: params.id } },
  });
  if (!membership) return NextResponse.json({ error: "Not a member of this league" }, { status: 403 });

  const { weekId } = await req.json();
  if (!weekId) return NextResponse.json({ error: "weekId is required" }, { status: 400 });

  const week = await prisma.week.findUnique({ where: { id: weekId } });
  if (!week || week.leagueId !== params.id) {
    return NextResponse.json({ error: "Week not found in this league" }, { status: 404 });
  }

  try {
    const result = await refreshWeekScores(weekId);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Score refresh failed unexpectedly" }, { status: 502 });
  }
}
