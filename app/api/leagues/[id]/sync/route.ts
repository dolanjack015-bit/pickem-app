import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { syncWeek, syncFullSeason, syncCfbWeek0, syncCfbPostseason, syncWeekByDate } from "@/lib/sync";

/**
 * POST /api/leagues/:id/sync
 *
 * Single week (by ESPN week number): { sport, season, weekNumber, seasonType? }
 *   CFB Week 0 (weekNumber: 0) is automatically routed to a date-based
 *   sync (every game on Aug 29 of that season) instead of ESPN's week
 *   numbering. CFB Postseason (seasonType: 3) is automatically routed to
 *   a round-based sync that scans all postseason games and files them
 *   into distinct weeks by round (conference championships, bowls, each
 *   CFB Playoff round) — weekNumber is ignored for that request since the
 *   sync always covers every round in one pass.
 * Single week (by exact date, fallback): { sport, season, weekNumber, seasonType?, dateRange }
 *   dateRange is "YYYYMMDD" or "YYYYMMDD-YYYYMMDD". Use this when the
 *   week-number sync errors out because ESPN hasn't activated that
 *   season's week-indexing yet (the error message will say so).
 * Full season:  { sport, season, full: true }
 *   NFL  -> every regular-season + postseason week
 *   CFB  -> Week 0 (by date), every ranked-team regular-season game, and
 *           every postseason round (conference championships, bowls, CFB
 *           playoff) — Army-Navy always included
 *
 * CFB regular-season requests (single week or full season) default to
 * ranked-teams-only. Pass { allGames: true } to pull every game that
 * week instead, unranked included — has no effect on NFL, CFB Week 0, or
 * CFB postseason, which always include every game regardless.
 *
 * A full-season sync makes dozens of ESPN requests sequentially and can be
 * slow — see the note in lib/sync.ts about serverless timeouts.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (session.user as any).id as string;

  const membership = await prisma.leagueMember.findUnique({
    where: { userId_leagueId: { userId, leagueId: params.id } },
  });
  if (!membership) return NextResponse.json({ error: "Not a member of this league" }, { status: 403 });

  const body = await req.json();
  const { sport, season, weekNumber, seasonType, full, dateRange, allGames } = body;
  if (!sport || !season) {
    return NextResponse.json({ error: "sport and season are required" }, { status: 400 });
  }

  try {
    if (full) {
      const result = await syncFullSeason(params.id, sport, season, !!allGames);
      return NextResponse.json(result);
    }

    if (weekNumber === undefined || weekNumber === null) {
      return NextResponse.json({ error: "weekNumber is required unless full: true" }, { status: 400 });
    }

    if (sport === "CFB" && seasonType === 3) {
      const result = await syncCfbPostseason(params.id, season);
      return NextResponse.json(result);
    }

    const filter: "all" | "cfb" | undefined = sport === "CFB" ? (allGames ? "all" : "cfb") : undefined;

    if (dateRange) {
      const result = await syncWeekByDate(params.id, sport, season, weekNumber, seasonType ?? 2, dateRange, filter);
      return NextResponse.json(result);
    }

    if (sport === "CFB" && weekNumber === 0) {
      const result = await syncCfbWeek0(params.id, season);
      return NextResponse.json(result);
    }

    const result = await syncWeek(params.id, sport, season, weekNumber, seasonType ?? 2, filter);
    return NextResponse.json(result);
  } catch (err: any) {
    // Surface thrown errors (e.g. the ESPN season-mismatch check in
    // lib/espn.ts) as a proper JSON error response instead of letting them
    // crash the route with an empty/HTML body the client can't parse.
    return NextResponse.json({ error: err?.message ?? "Sync failed unexpectedly" }, { status: 502 });
  }
}
