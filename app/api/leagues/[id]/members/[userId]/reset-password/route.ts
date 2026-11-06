import { NextResponse } from "next/server";
import { randomInt } from "crypto";
import bcrypt from "bcryptjs";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// No look-alike characters (0/O, 1/l/I) so it's easy to read out or type.
const ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function makeTempPassword(length = 12): string {
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

/**
 * POST /api/leagues/:id/members/:userId/reset-password
 *
 * Owner-only. Sets a new random temporary password for another member of
 * this league and returns it ONCE in the response — it's never stored in
 * readable form (only the bcrypt hash is saved, same as sign-up), so it
 * can't be looked up again later; the owner would just reset it again.
 */
export async function POST(_req: Request, { params }: { params: { id: string; userId: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const requesterId = (session.user as any).id as string;

    const requester = await prisma.leagueMember.findUnique({
      where: { userId_leagueId: { userId: requesterId, leagueId: params.id } },
    });
    if (!requester || requester.role !== "owner") {
      return NextResponse.json({ error: "Only the league owner can reset a member's password" }, { status: 403 });
    }

    if (params.userId === requesterId) {
      return NextResponse.json({ error: "You can't reset your own password this way" }, { status: 400 });
    }

    const target = await prisma.leagueMember.findUnique({
      where: { userId_leagueId: { userId: params.userId, leagueId: params.id } },
    });
    if (!target) return NextResponse.json({ error: "That person isn't a member of this league" }, { status: 404 });
    if (target.role === "owner") {
      return NextResponse.json({ error: "You can't reset another owner's password" }, { status: 400 });
    }

    const tempPassword = makeTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 10);
    await prisma.user.update({ where: { id: params.userId }, data: { passwordHash } });

    return NextResponse.json({ tempPassword });
  } catch (err: any) {
    console.error("Password reset failed:", err);
    return NextResponse.json({ error: "Password reset failed. Please try again in a moment." }, { status: 500 });
  }
}
