import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (session.user as any).id as string;

  const { inviteCode } = await req.json();
  if (!inviteCode) return NextResponse.json({ error: "inviteCode is required" }, { status: 400 });

  const league = await prisma.league.findUnique({ where: { inviteCode: String(inviteCode).toUpperCase() } });
  if (!league) return NextResponse.json({ error: "No league found with that invite code" }, { status: 404 });

  const existing = await prisma.leagueMember.findUnique({
    where: { userId_leagueId: { userId, leagueId: league.id } },
  });
  if (existing) return NextResponse.json(league);

  await prisma.leagueMember.create({ data: { userId, leagueId: league.id, role: "member" } });
  return NextResponse.json(league);
}
