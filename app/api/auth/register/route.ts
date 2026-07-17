import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  try {
    const { email, username, password } = await req.json();

    if (!email || !username || !password) {
      return NextResponse.json({ error: "email, username, and password are required" }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }

    const normalizedEmail = String(email).toLowerCase().trim();

    const existing = await prisma.user.findFirst({
      where: { OR: [{ email: normalizedEmail }, { username }] },
    });
    if (existing) {
      return NextResponse.json({ error: "Email or username already in use" }, { status: 409 });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { email: normalizedEmail, username, passwordHash },
    });

    return NextResponse.json({ id: user.id, email: user.email, username: user.username });
  } catch (err: any) {
    // Without this, a database connection error (a common one: Neon's
    // pooled connection needs `pgbouncer=true` in the URL for Prisma in a
    // serverless environment — see the note in .env.example) crashes this
    // route with an empty response instead of a readable error.
    console.error("Registration failed:", err);
    return NextResponse.json({ error: "Registration failed. Please try again in a moment." }, { status: 500 });
  }
}
