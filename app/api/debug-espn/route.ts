import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * TEMPORARY DIAGNOSTIC ROUTE — read-only, no DB writes, no auth beyond
 * "must be logged in" (doesn't need league membership since it isn't
 * looking at any league's data).
 *
 * GET /api/debug-espn?sport=CFB&dates=20260917-20260921
 *
 * Hits ESPN's scoreboard endpoint with whatever `dates` value you give it
 * and reports back the raw HTTP status and response so we can figure out
 * exactly which date formats ESPN currently accepts. Safe to delete once
 * the refresh-scores bug is tracked down.
 */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const sport = (searchParams.get("sport") ?? "CFB").toUpperCase();
  const dates = searchParams.get("dates") ?? "20260918";
  const path = sport === "NFL" ? "football/nfl" : "football/college-football";
  const url = `https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard?dates=${dates}&limit=400`;

  try {
    const res = await fetch(url, { next: { revalidate: 0 } });
    const text = await res.text();
    let parsed: any = null;
    let eventCount: number | null = null;
    try {
      parsed = JSON.parse(text);
      eventCount = Array.isArray(parsed?.events) ? parsed.events.length : null;
    } catch {
      // leave parsed null if it's not JSON (e.g. an HTML error page)
    }
    return NextResponse.json({
      urlTried: url,
      httpStatus: res.status,
      httpOk: res.ok,
      eventCount,
      bodySnippet: text.slice(0, 500),
    });
  } catch (err: any) {
    return NextResponse.json({ urlTried: url, error: err?.message ?? String(err) });
  }
}
