import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateInviteCode } from "@/lib/utils";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (session.user as any).id as string;

  const memberships = await prisma.leagueMember.findMany({
    where: { userId },
    include: { league: true },
  });

  return NextResponse.json(memberships.map((m) => ({ ...m.league, role: m.role })));
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (session.user as any).id as string;

  const { name, sport } = await req.json();
  if (!name || !sport) {
    return NextResponse.json({ error: "name and sport are required" }, { status: 400 });
  }
  if (!["NFL", "CFB", "BOTH"].includes(sport)) {
    return NextResponse.json({ error: "sport must be NFL, CFB, or BOTH" }, { status: 400 });
  }

  let inviteCode = generateInviteCode();
  // Extremely unlikely collision, but guard anyway.
  for (let i = 0; i < 5; i++) {
    const clash = await prisma.league.findUnique({ where: { inviteCode } });
    if (!clash) break;
    inviteCode = generateInviteCode();
  }

  const league = await prisma.league.create({
    data: {
      name,
      sport,
      inviteCode,
      ownerId: userId,
      members: { create: { userId, role: "owner" } },
    },
  });

  return NextResponse.json(league);
}
