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

  // Rankings mode: GET /api/debug-espn?rankings=1&week=10&year=2026
  // Lists every poll ESPN returns for that week (name + how many teams),
  // so we can confirm the College Football Playoff poll is there and what
  // it's called.
  if (searchParams.get("rankings")) {
    const week = searchParams.get("week") ?? "10";
    const year = searchParams.get("year") ?? "2026";
    const seasontype = searchParams.get("seasontype") ?? "2";
    const rUrl = `https://site.api.espn.com/apis/site/v2/sports/football/college-football/rankings?week=${week}&year=${year}&seasontype=${seasontype}`;
    try {
      const res = await fetch(rUrl, { next: { revalidate: 0 } });
      const data: any = await res.json().catch(() => null);
      const polls: any[] = data?.rankings ?? [];
      return NextResponse.json({
        urlTried: rUrl,
        httpStatus: res.status,
        polls: polls.map((p) => ({
          name: p.name,
          shortName: p.shortName,
          type: p.type,
          teamsRanked: Array.isArray(p.ranks) ? p.ranks.length : 0,
          top5: (p.ranks ?? []).slice(0, 5).map((r: any) => `${r.current}. ${r.team?.abbreviation}`),
        })),
      });
    } catch (err: any) {
      return NextResponse.json({ urlTried: rUrl, error: err?.message ?? String(err) });
    }
  }

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
