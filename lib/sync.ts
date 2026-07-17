import { prisma } from "./prisma";
import { fetchScoreboard, fetchScoreboardByDate, fetchApPoll, SEASON_STRUCTURE, NormalizedGame, cfbWeek0DateBounds } from "./espn";
import { gradePick } from "./utils";

type Sport = "NFL" | "CFB";

function isArmyNavy(g: NormalizedGame): boolean {
  const abbrs = [g.homeTeamAbbr, g.awayTeamAbbr].map((a) => a?.toUpperCase());
  return abbrs.includes("ARMY") && abbrs.includes("NAVY");
}

/** True if a game's kickoff falls on CFB Week 0's anchor date (Aug 29 by default) — used to keep Week 0 games from also showing up under Week 1 or any other week. */
function isWeek0DatedGame(g: NormalizedGame, season: number): boolean {
  const { start, end } = cfbWeek0DateBounds(season);
  const t = new Date(g.startTime).getTime();
  return t >= start.getTime() && t <= end.getTime();
}

/**
 * CFB postseason "rounds," each stored as its own Week (seasonType 3),
 * the same way NFL wild card / divisional / conference / Super Bowl each
 * get their own week. Order here doubles as match-priority: check the
 * most specific round names (semifinal, national championship) before
 * falling back to generic "bowl."
 */
const CFB_POSTSEASON_ROUNDS: { weekNumber: number; label: string; match: (noteText: string) => boolean }[] = [
  { weekNumber: 6, label: "CFB Playoff: National Championship", match: (t) => /national championship/.test(t) },
  { weekNumber: 5, label: "CFB Playoff: Semifinal", match: (t) => /semi[\s-]?final/.test(t) },
  { weekNumber: 4, label: "CFB Playoff: Quarterfinal", match: (t) => /quarter[\s-]?final/.test(t) },
  { weekNumber: 3, label: "CFB Playoff: First Round", match: (t) => /first[\s-]?round/.test(t) || /cfp first round/.test(t) },
  { weekNumber: 1, label: "Conference Championship", match: (t) => /championship/.test(t) }, // after national champ/semis so it doesn't shadow them
];

export const CFB_POSTSEASON_ROUND_LABELS: Record<number, string> = {
  1: "Conference Championships",
  2: "Bowl Season",
  3: "CFB Playoff: First Round",
  4: "CFB Playoff: Quarterfinal",
  5: "CFB Playoff: Semifinal",
  6: "CFB Playoff: National Championship",
};

function categorizeCfbPostseasonGame(g: NormalizedGame): { weekNumber: number; gameLabel: string } {
  const noteText = g.notes.join(" ").toLowerCase();
  for (const round of CFB_POSTSEASON_ROUNDS) {
    if (round.match(noteText)) return { weekNumber: round.weekNumber, gameLabel: round.label };
  }
  // Anything postseason that isn't a conference championship or a
  // playoff-round game is a regular (non-playoff) bowl.
  return { weekNumber: 2, gameLabel: g.notes[0] ? `Bowl: ${g.notes[0]}` : "Bowl Game" };
}

/** Recompute a Week's picks-lock time from its current games (earliest kickoff wins) and save it. */
async function refreshWeekLockTime(weekId: string) {
  const earliest = await prisma.game.findFirst({
    where: { weekId },
    orderBy: { startTime: "asc" },
    select: { startTime: true },
  });
  if (earliest) {
    await prisma.week.update({ where: { id: weekId }, data: { picksLockAt: earliest.startTime } });
  }
}

/**
 * Sync one scoreboard slate (a single week + seasonType) into the DB.
 *
 * `filter: "all"` (default) stores every game ESPN returns — used for NFL,
 * where every regular-season and playoff game should show up.
 *
 * `filter: "cfb"` applies the CFB-specific rule: keep a game only if it's
 * postseason (conference championship / bowl / CFB playoff), the
 * Army-Navy game, or has a ranked team per the AP poll. Everything else is
 * skipped so a league isn't flooded with 60+ unranked FCS-vs-FBS games
 * every Saturday. (CFB Week 0 is synced separately — see syncCfbWeek0.)
 */
export async function syncWeek(
  leagueId: string,
  sport: Sport,
  season: number,
  weekNumber: number,
  seasonType: number = 2,
  filter: "all" | "cfb" = sport === "CFB" ? "cfb" : "all"
) {
  const games = await fetchScoreboard(sport, { week: weekNumber, year: season, seasontype: seasonType });

  let rankings = new Map<string, number>();
  if (sport === "CFB") {
    try {
      rankings = await fetchApPoll({ week: weekNumber, year: season, seasontype: seasonType });
      // Postseason "weeks" in ESPN's scoreboard don't line up with poll
      // weeks. Fall back to the final regular-season poll so bowl-game rank
      // badges still have something to show.
      if (rankings.size === 0 && seasonType === 3) {
        rankings = await fetchApPoll({ week: 15, year: season, seasontype: 2 });
      }
    } catch {
      rankings = new Map(); // rankings are a nice-to-have; never fail the sync over them.
      // Note: during the off-season (no games being played), the AP poll
      // endpoint may return nothing at all — that's expected, not a bug.
      // Rankings start populating once the preseason poll drops in August.
    }
  }

  const week = await prisma.week.upsert({
    where: { leagueId_season_weekNumber_seasonType_sport: { leagueId, season, weekNumber, seasonType, sport } },
    update: {},
    create: { leagueId, season, weekNumber, seasonType, sport },
  });

  const toSave: { g: NormalizedGame; homeRank: number | null; awayRank: number | null; gameLabel: string | null }[] = [];
  for (const g of games) {
    const homeRank = rankings.get(g.homeTeamAbbr?.toUpperCase()) ?? null;
    const awayRank = rankings.get(g.awayTeamAbbr?.toUpperCase()) ?? null;
    const armyNavy = isArmyNavy(g);

    // Week 0 is synced separately (syncCfbWeek0) and owns its date — if
    // ESPN's "week 1" grouping happens to include Aug 29 games too, don't
    // let them also land here.
    if (sport === "CFB" && weekNumber !== 0 && isWeek0DatedGame(g, season)) continue;
    if (filter === "cfb") {
      const keep = seasonType === 3 || armyNavy || homeRank != null || awayRank != null;
      if (!keep) continue;
    }

    let gameLabel: string | null = null;
    if (armyNavy) gameLabel = "Army-Navy";

    toSave.push({ g, homeRank, awayRank, gameLabel });
  }

  const keptEventIds = new Set(toSave.map((x) => x.g.espnEventId));

  const savedGames = await Promise.all(
    toSave.map(({ g, homeRank, awayRank, gameLabel }) =>
      prisma.game.upsert({
        where: { weekId_espnEventId: { weekId: week.id, espnEventId: g.espnEventId } },
        update: {
          status: g.status,
          homeScore: g.homeScore,
          awayScore: g.awayScore,
          winner: g.winner,
          homeLogo: g.homeLogo,
          awayLogo: g.awayLogo,
          homeLogoThrowback: g.homeLogoThrowback,
          awayLogoThrowback: g.awayLogoThrowback,
          homeRecord: g.homeRecord,
          awayRecord: g.awayRecord,
          homeRank,
          awayRank,
          gameLabel,
        },
        create: {
          weekId: week.id,
          espnEventId: g.espnEventId,
          homeTeam: g.homeTeam,
          awayTeam: g.awayTeam,
          homeTeamAbbr: g.homeTeamAbbr,
          awayTeamAbbr: g.awayTeamAbbr,
          startTime: new Date(g.startTime),
          status: g.status,
          homeScore: g.homeScore,
          awayScore: g.awayScore,
          winner: g.winner,
          homeLogo: g.homeLogo,
          awayLogo: g.awayLogo,
          homeLogoThrowback: g.homeLogoThrowback,
          awayLogoThrowback: g.awayLogoThrowback,
          homeRecord: g.homeRecord,
          awayRecord: g.awayRecord,
          homeRank,
          awayRank,
          gameLabel,
        },
      })
    )
  );
  const savedCount = savedGames.length;

  const finalGames = savedGames.filter((game) => game.status === "final" && game.winner);
  let gradedCount = 0;
  if (finalGames.length > 0) {
    const winnerByGameId = new Map(finalGames.map((g) => [g.id, g.winner as "home" | "away" | "tie"]));
    const picks = await prisma.pick.findMany({ where: { gameId: { in: finalGames.map((g) => g.id) } } });
    const toUpdate = picks
      .map((pick) => ({ pick, isCorrect: gradePick(pick.pickedTeam as "home" | "away", winnerByGameId.get(pick.gameId)!) }))
      .filter(({ pick, isCorrect }) => pick.isCorrect !== isCorrect);
    await Promise.all(toUpdate.map(({ pick, isCorrect }) => prisma.pick.update({ where: { id: pick.id }, data: { isCorrect } })));
    gradedCount = toUpdate.length;
  }

  // An owner's sync is authoritative for this week: any game that was
  // saved here before (e.g. from an earlier ESPN reliability hiccup, like
  // Week 0's games bleeding into Week 1) but doesn't belong per this
  // sync's results gets removed now, along with any picks on it.
  const removed = await prisma.game.deleteMany({
    where: { weekId: week.id, isManual: false, espnEventId: { notIn: [...keptEventIds] } },
  });

  await refreshWeekLockTime(week.id);

  return { weekId: week.id, gamesFromEspn: games.length, gamesSaved: savedCount, gamesRemoved: removed.count, picksGraded: gradedCount };
}

/**
 * CFB postseason, synced as distinct rounds — the same mental model as
 * NFL playoffs (wild card / divisional / conference / Super Bowl each get
 * their own Week). Scans a generous range of ESPN's postseason "weeks"
 * (their grouping mixes bowls and playoff rounds together and isn't
 * reliable for this), collects every game once, categorizes each by its
 * `notes` text (conference championship / playoff round / plain bowl),
 * and files it into one of six fixed system weeks — see
 * CFB_POSTSEASON_ROUND_LABELS for what each weekNumber means.
 */
export async function syncCfbPostseason(leagueId: string, season: number) {
  const espnWeeksToScan = [1, 2, 3, 4, 5, 6];
  const seenGames = new Map<string, NormalizedGame>();

  for (const w of espnWeeksToScan) {
    try {
      const games = await fetchScoreboard("CFB", { week: w, year: season, seasontype: 3 });
      for (const g of games) seenGames.set(g.espnEventId, g);
    } catch {
      // A given ESPN "week" slot may simply not exist for postseason —
      // skip it rather than failing the whole sync over one empty slot.
    }
  }

  // Conference championship games (SEC Championship, Big Ten Championship,
  // etc.) are classified by ESPN as regular season (seasontype 2), not
  // postseason — typically weeks 15-16. Scan those too and pull in only
  // the ones actually labeled as a championship, so they land in the
  // Conference Championships bucket instead of never being found at all.
  for (const w of [15, 16]) {
    try {
      const games = await fetchScoreboard("CFB", { week: w, year: season, seasontype: 2 });
      for (const g of games) {
        if (/championship/i.test(g.notes.join(" "))) seenGames.set(g.espnEventId, g);
      }
    } catch {
      // ignore — same reasoning as above
    }
  }

  let rankings = new Map<string, number>();
  try {
    rankings = await fetchApPoll({ week: 15, year: season, seasontype: 2 }); // final regular-season poll
  } catch {
    rankings = new Map();
  }

  // Games from a prior sync (before a categorization fix, or just a
  // re-sync in general) may already exist under a *different* postseason
  // week than where they now belong. Look those up so we can move them
  // instead of creating stray duplicates and orphaning their picks.
  const existingGames = await prisma.game.findMany({
    where: {
      espnEventId: { in: [...seenGames.keys()] },
      week: { leagueId, season, sport: "CFB", seasonType: 3 },
    },
    select: { id: true, espnEventId: true, weekId: true },
  });
  const existingByEspnId = new Map(existingGames.map((g) => [g.espnEventId, g]));

  // Bucket games by round, then upsert one Week per non-empty bucket.
  const byWeekNumber = new Map<number, { games: NormalizedGame[]; gameLabel: string }>();
  for (const g of seenGames.values()) {
    const { weekNumber, gameLabel } = categorizeCfbPostseasonGame(g);
    if (!byWeekNumber.has(weekNumber)) byWeekNumber.set(weekNumber, { games: [], gameLabel });
    byWeekNumber.get(weekNumber)!.games.push(g);
  }

  let totalSaved = 0;
  let totalGraded = 0;
  const weeksSynced: number[] = [];

  for (const [weekNumber, bucket] of byWeekNumber) {
    const week = await prisma.week.upsert({
      where: { leagueId_season_weekNumber_seasonType_sport: { leagueId, season, weekNumber, seasonType: 3, sport: "CFB" } },
      update: {},
      create: { leagueId, season, weekNumber, seasonType: 3, sport: "CFB" },
    });
    weeksSynced.push(weekNumber);

    for (const g of bucket.games) {
      const homeRank = rankings.get(g.homeTeamAbbr?.toUpperCase()) ?? null;
      const awayRank = rankings.get(g.awayTeamAbbr?.toUpperCase()) ?? null;
      const armyNavy = isArmyNavy(g); // defensive; Army-Navy is a regular-season game and won't normally appear here

      const fieldData = {
        status: g.status,
        homeScore: g.homeScore,
        awayScore: g.awayScore,
        winner: g.winner,
        homeLogo: g.homeLogo,
        awayLogo: g.awayLogo,
        homeLogoThrowback: g.homeLogoThrowback,
        awayLogoThrowback: g.awayLogoThrowback,
        homeRecord: g.homeRecord,
        awayRecord: g.awayRecord,
        homeRank,
        awayRank,
        gameLabel: armyNavy ? "Army-Navy" : bucket.gameLabel,
      };

      const existing = existingByEspnId.get(g.espnEventId);
      let game;
      if (existing && existing.weekId !== week.id) {
        // Already exists, but under the wrong (pre-fix) week — move it in
        // place so existing picks on it stay intact.
        game = await prisma.game.update({ where: { id: existing.id }, data: { ...fieldData, weekId: week.id } });
      } else {
        game = await prisma.game.upsert({
          where: { weekId_espnEventId: { weekId: week.id, espnEventId: g.espnEventId } },
          update: fieldData,
          create: {
            weekId: week.id,
            espnEventId: g.espnEventId,
            homeTeam: g.homeTeam,
            awayTeam: g.awayTeam,
            homeTeamAbbr: g.homeTeamAbbr,
            awayTeamAbbr: g.awayTeamAbbr,
            startTime: new Date(g.startTime),
            ...fieldData,
          },
        });
      }
      totalSaved++;

      if (game.status === "final" && game.winner) {
        const picks = await prisma.pick.findMany({ where: { gameId: game.id } });
        for (const pick of picks) {
          const isCorrect = gradePick(pick.pickedTeam as "home" | "away", game.winner as any);
          if (pick.isCorrect !== isCorrect) {
            await prisma.pick.update({ where: { id: pick.id }, data: { isCorrect } });
            totalGraded++;
          }
        }
      }
    }

    await refreshWeekLockTime(week.id);
  }

  return { weeksSynced: weeksSynced.length, roundsFound: weeksSynced.sort(), gamesFromEspn: seenGames.size, gamesSaved: totalSaved, picksGraded: totalGraded };
}

/**
 * Fallback for when `syncWeek`'s week/year lookup fails because ESPN
 * hasn't activated that season's week-indexing yet (see the check in
 * fetchScoreboard). Pulls games by exact calendar date/range instead —
 * this works even for seasons ESPN hasn't "started" internally, as long
 * as the schedule is public — and files them under whatever
 * season/weekNumber/seasonType label you give it.
 */
export async function syncWeekByDate(
  leagueId: string,
  sport: Sport,
  season: number,
  weekNumber: number,
  seasonType: number,
  dateRange: string, // "20260903-20260909" or a single "20260904"
  filter: "all" | "cfb" = sport === "CFB" ? "cfb" : "all"
) {
  const games = await fetchScoreboardByDate(sport, dateRange);

  let rankings = new Map<string, number>();
  if (sport === "CFB") {
    try {
      rankings = await fetchApPoll({ week: weekNumber, year: season, seasontype: seasonType });
    } catch {
      rankings = new Map();
    }
  }

  const week = await prisma.week.upsert({
    where: { leagueId_season_weekNumber_seasonType_sport: { leagueId, season, weekNumber, seasonType, sport } },
    update: {},
    create: { leagueId, season, weekNumber, seasonType, sport },
  });

  // Filtering is pure/synchronous — figure out which games we're keeping
  // before touching the database at all.
  const toSave: { g: NormalizedGame; homeRank: number | null; awayRank: number | null; gameLabel: string | null }[] = [];
  for (const g of games) {
    const homeRank = rankings.get(g.homeTeamAbbr?.toUpperCase()) ?? null;
    const awayRank = rankings.get(g.awayTeamAbbr?.toUpperCase()) ?? null;
    const armyNavy = isArmyNavy(g);

    if (sport === "CFB" && seasonType !== 1 && weekNumber !== 0 && isWeek0DatedGame(g, season)) continue;
    if (filter === "cfb") {
      const keep = seasonType === 1 || seasonType === 3 || armyNavy || homeRank != null || awayRank != null;
      if (!keep) continue;
    }

    let gameLabel: string | null = null;
    if (armyNavy) gameLabel = "Army-Navy";
    else if (seasonType === 1) gameLabel = "Week 0";
    else if (seasonType === 3 && sport === "CFB") gameLabel = categorizeCfbPostseasonGame(g).gameLabel;

    toSave.push({ g, homeRank, awayRank, gameLabel });
  }

  const keptEventIds = new Set(toSave.map((x) => x.g.espnEventId));

  // Upsert every kept game in parallel instead of one at a time — this is
  // the main thing that was making syncs slow, especially for CFB weeks
  // with a dozen-plus games.
  const savedGames = await Promise.all(
    toSave.map(({ g, homeRank, awayRank, gameLabel }) =>
      prisma.game.upsert({
        where: { weekId_espnEventId: { weekId: week.id, espnEventId: g.espnEventId } },
        update: {
          status: g.status,
          homeScore: g.homeScore,
          awayScore: g.awayScore,
          winner: g.winner,
          homeLogo: g.homeLogo,
          awayLogo: g.awayLogo,
          homeLogoThrowback: g.homeLogoThrowback,
          awayLogoThrowback: g.awayLogoThrowback,
          homeRecord: g.homeRecord,
          awayRecord: g.awayRecord,
          homeRank,
          awayRank,
          gameLabel,
        },
        create: {
          weekId: week.id,
          espnEventId: g.espnEventId,
          homeTeam: g.homeTeam,
          awayTeam: g.awayTeam,
          homeTeamAbbr: g.homeTeamAbbr,
          awayTeamAbbr: g.awayTeamAbbr,
          startTime: new Date(g.startTime),
          status: g.status,
          homeScore: g.homeScore,
          awayScore: g.awayScore,
          winner: g.winner,
          homeLogo: g.homeLogo,
          awayLogo: g.awayLogo,
          homeLogoThrowback: g.homeLogoThrowback,
          awayLogoThrowback: g.awayLogoThrowback,
          homeRecord: g.homeRecord,
          awayRecord: g.awayRecord,
          homeRank,
          awayRank,
          gameLabel,
        },
      })
    )
  );
  const savedCount = savedGames.length;

  // Grade picks in two batched queries (one findMany, one set of parallel
  // updates) instead of a query per game — meaningfully faster once a
  // week has several finished games.
  const finalGames = savedGames.filter((game) => game.status === "final" && game.winner);
  let gradedCount = 0;
  if (finalGames.length > 0) {
    const winnerByGameId = new Map(finalGames.map((g) => [g.id, g.winner as "home" | "away" | "tie"]));
    const picks = await prisma.pick.findMany({ where: { gameId: { in: finalGames.map((g) => g.id) } } });
    const toUpdate = picks
      .map((pick) => ({ pick, isCorrect: gradePick(pick.pickedTeam as "home" | "away", winnerByGameId.get(pick.gameId)!) }))
      .filter(({ pick, isCorrect }) => pick.isCorrect !== isCorrect);
    await Promise.all(toUpdate.map(({ pick, isCorrect }) => prisma.pick.update({ where: { id: pick.id }, data: { isCorrect } })));
    gradedCount = toUpdate.length;
  }

  const removed = await prisma.game.deleteMany({
    where: { weekId: week.id, isManual: false, espnEventId: { notIn: [...keptEventIds] } },
  });

  await refreshWeekLockTime(week.id);

  return { weekId: week.id, gamesFromEspn: games.length, gamesSaved: savedCount, gamesRemoved: removed.count, picksGraded: gradedCount };
}

/**
 * CFB Week 0: every game played on a fixed calendar date (default: Aug 29
 * of the given season year) rather than an ESPN week number, since ESPN's
 * own numbering for that slate is inconsistent. Every game on that date is
 * kept, regardless of ranking.
 */
export async function syncCfbWeek0(leagueId: string, season: number, dateOverride?: string) {
  const dateStr = dateOverride ?? `${season}0829`;
  const games = await fetchScoreboardByDate("CFB", dateStr);

  const week = await prisma.week.upsert({
    where: { leagueId_season_weekNumber_seasonType_sport: { leagueId, season, weekNumber: 0, seasonType: 1, sport: "CFB" } },
    update: {},
    create: { leagueId, season, weekNumber: 0, seasonType: 1, sport: "CFB" },
  });

  let gradedCount = 0;
  let savedCount = 0;

  for (const g of games) {
    const game = await prisma.game.upsert({
      where: { weekId_espnEventId: { weekId: week.id, espnEventId: g.espnEventId } },
      update: {
        status: g.status,
        homeScore: g.homeScore,
        awayScore: g.awayScore,
        winner: g.winner,
        homeLogo: g.homeLogo,
        awayLogo: g.awayLogo,
        homeLogoThrowback: g.homeLogoThrowback,
        awayLogoThrowback: g.awayLogoThrowback,
        homeRecord: g.homeRecord,
        awayRecord: g.awayRecord,
        gameLabel: "Week 0",
      },
      create: {
        weekId: week.id,
        espnEventId: g.espnEventId,
        homeTeam: g.homeTeam,
        awayTeam: g.awayTeam,
        homeTeamAbbr: g.homeTeamAbbr,
        awayTeamAbbr: g.awayTeamAbbr,
        startTime: new Date(g.startTime),
        status: g.status,
        homeScore: g.homeScore,
        awayScore: g.awayScore,
        winner: g.winner,
        homeLogo: g.homeLogo,
        awayLogo: g.awayLogo,
        homeLogoThrowback: g.homeLogoThrowback,
        awayLogoThrowback: g.awayLogoThrowback,
        homeRecord: g.homeRecord,
        awayRecord: g.awayRecord,
        gameLabel: "Week 0",
      },
    });
    savedCount++;

    if (game.status === "final" && game.winner) {
      const picks = await prisma.pick.findMany({ where: { gameId: game.id } });
      for (const pick of picks) {
        const isCorrect = gradePick(pick.pickedTeam as "home" | "away", game.winner as any);
        if (pick.isCorrect !== isCorrect) {
          await prisma.pick.update({ where: { id: pick.id }, data: { isCorrect } });
          gradedCount++;
        }
      }
    }
  }

  await refreshWeekLockTime(week.id);

  return { weekId: week.id, gamesFromEspn: games.length, gamesSaved: savedCount, picksGraded: gradedCount };
}

/**
 * Sync an entire season in one call: every NFL regular-season + postseason
 * week, or every relevant CFB week (Week 0 by date, ranked regular-season
 * games, conference championships, bowls, CFB playoff — Army-Navy always
 * included).
 *
 * Loops sequentially and can take a while (dozens of ESPN requests) — on
 * Vercel's Hobby plan this will likely exceed the 10s serverless function
 * timeout. Use a paid plan's longer timeout, run this from `next dev`/a
 * local script, or call `syncWeek` incrementally instead for a
 * free-tier-friendly rollout.
 */
export async function syncFullSeason(leagueId: string, sport: Sport, season: number, cfbAllGames: boolean = false) {
  const results: { gamesSaved: number; picksGraded: number; weeksSynced?: number }[] = [];
  const errors: { weekNumber: number; error: string }[] = [];

  const safeSyncWeek = async (weekNumber: number, seasonType: number, filter: "all" | "cfb") => {
    try {
      results.push(await syncWeek(leagueId, sport, season, weekNumber, seasonType, filter));
    } catch (err: any) {
      // One unreliable week (a known ESPN issue for some CFB weeks) shouldn't
      // abort the whole run — record it and keep going with the rest.
      errors.push({ weekNumber, error: err?.message ?? "Unknown error" });
    }
  };

  if (sport === "NFL") {
    for (const w of SEASON_STRUCTURE.NFL.regularWeeks) {
      await safeSyncWeek(w, 2, "all");
    }
    for (const w of SEASON_STRUCTURE.NFL.postseasonWeeks) {
      await safeSyncWeek(w, 3, "all");
    }
  } else {
    results.push(await syncCfbWeek0(leagueId, season));
    for (const w of SEASON_STRUCTURE.CFB.regularWeeks) {
      await safeSyncWeek(w, 2, cfbAllGames ? "all" : "cfb");
    }
    results.push(await syncCfbPostseason(leagueId, season));
  }

  return {
    weeksSynced: results.reduce((sum, r: any) => sum + (r.weeksSynced ?? 1), 0),
    gamesSaved: results.reduce((sum, r) => sum + r.gamesSaved, 0),
    gamesRemoved: results.reduce((sum, r: any) => sum + (r.gamesRemoved ?? 0), 0),
    picksGraded: results.reduce((sum, r) => sum + r.picksGraded, 0),
    weeksFailed: errors.length,
    errors: errors.length > 0 ? errors : undefined,
  };
}

/**
 * Set the final score on a manually-entered game (e.g. a fantasy matchup)
 * and grade every pick tied to it. Ties are graded as a push (no one
 * correct) via gradePick's tie handling — most fantasy platforms don't
 * allow ties in H2H matchups, but it's handled defensively just in case.
 */
/**
 * Lightweight, non-destructive score refresh for a week that's already
 * been set up. Unlike syncWeek/syncCfbWeek0/syncCfbPostseason, this never
 * adds a new game to the week and never re-applies the ranked-only (or
 * any other) filter — it only updates status/score/winner/rank/record on
 * games that already exist in that week, and grades picks as games go
 * final. This is what keeps "who's picking what" stable once the owner
 * has set a week's matchups: anyone can refresh scores, but the game set
 * itself only changes when the owner explicitly re-syncs it.
 *
 * Finds games by date range (spanning the existing games' kickoff times,
 * with a day of padding) rather than trusting ESPN's week/year param —
 * since we already know exactly which games we're looking for, this
 * sidesteps the week-number reliability issues entirely.
 */
export async function refreshWeekScores(weekId: string) {
  const week = await prisma.week.findUnique({ where: { id: weekId }, include: { games: true } });
  if (!week || week.games.length === 0) return { gamesUpdated: 0, picksGraded: 0 };
  if (week.sport === "FANTASY") return { gamesUpdated: 0, picksGraded: 0 }; // fantasy scores are entered by hand, not synced

  const times = week.games.map((g) => new Date(g.startTime).getTime());
  const minDate = new Date(Math.min(...times) - 24 * 60 * 60 * 1000);
  const maxDate = new Date(Math.max(...times) + 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
  const dateRange = `${fmt(minDate)}-${fmt(maxDate)}`;

  let fetched: NormalizedGame[] = [];
  try {
    fetched = await fetchScoreboardByDate(week.sport as Sport, dateRange);
  } catch {
    return { gamesUpdated: 0, picksGraded: 0 }; // transient ESPN issue — leave existing data alone, try again next time
  }

  let rankings = new Map<string, number>();
  if (week.sport === "CFB") {
    try {
      rankings = await fetchApPoll({ week: week.weekNumber, year: week.season, seasontype: week.seasonType });
    } catch {
      rankings = new Map();
    }
  }

  const byEspnId = new Map(fetched.map((g) => [g.espnEventId, g]));
  let gamesUpdated = 0;
  let picksGraded = 0;

  for (const existing of week.games) {
    const g = byEspnId.get(existing.espnEventId);
    if (!g) continue; // this game just isn't in today's fetch window — leave it as-is, not an error

    const homeRank = rankings.get(g.homeTeamAbbr?.toUpperCase()) ?? existing.homeRank;
    const awayRank = rankings.get(g.awayTeamAbbr?.toUpperCase()) ?? existing.awayRank;

    const unchanged =
      existing.status === g.status &&
      existing.homeScore === g.homeScore &&
      existing.awayScore === g.awayScore &&
      existing.homeRank === homeRank &&
      existing.awayRank === awayRank;
    if (unchanged) continue;

    const updated = await prisma.game.update({
      where: { id: existing.id },
      data: {
        status: g.status,
        homeScore: g.homeScore,
        awayScore: g.awayScore,
        winner: g.winner,
        homeRecord: g.homeRecord,
        awayRecord: g.awayRecord,
        homeRank,
        awayRank,
      },
    });
    gamesUpdated++;

    if (updated.status === "final" && updated.winner) {
      const picks = await prisma.pick.findMany({ where: { gameId: updated.id } });
      for (const pick of picks) {
        const isCorrect = gradePick(pick.pickedTeam as "home" | "away", updated.winner as any);
        if (pick.isCorrect !== isCorrect) {
          await prisma.pick.update({ where: { id: pick.id }, data: { isCorrect } });
          picksGraded++;
        }
      }
    }
  }

  return { gamesUpdated, picksGraded };
}

/**
 * Score-refresh version of refreshWeekScores for every active (non-final)
 * NFL/CFB week across every league — this is what the cron job and any
 * member's "Refresh scores" button should call, since neither should ever
 * be able to change which games are in a week.
 */
export async function refreshAllActiveWeeks() {
  const activeWeeks = await prisma.week.findMany({
    where: { sport: { in: ["NFL", "CFB"] }, games: { some: { status: { not: "final" } } } },
  });

  const results = [];
  for (const week of activeWeeks) {
    try {
      const result = await refreshWeekScores(week.id);
      results.push({ weekId: week.id, ...result });
    } catch (err: any) {
      results.push({ weekId: week.id, error: err.message });
    }
  }
  return { weeksChecked: results.length, results };
}

/**
 * Set the final score on a manually-entered game (e.g. a fantasy matchup)
 * and grade every pick tied to it. Ties are graded as a push (no one
 * correct) via gradePick's tie handling — most fantasy platforms don't
 * allow ties in H2H matchups, but it's handled defensively just in case.
 */
export async function gradeManualGame(gameId: string, homeScore: number, awayScore: number) {
  const winner: "home" | "away" | "tie" = homeScore === awayScore ? "tie" : homeScore > awayScore ? "home" : "away";

  await prisma.game.update({
    where: { id: gameId },
    data: { homeScore, awayScore, winner, status: "final" },
  });

  const picks = await prisma.pick.findMany({ where: { gameId } });
  let gradedCount = 0;
  for (const pick of picks) {
    const isCorrect = gradePick(pick.pickedTeam as "home" | "away", winner);
    if (pick.isCorrect !== isCorrect) {
      await prisma.pick.update({ where: { id: pick.id }, data: { isCorrect } });
      gradedCount++;
    }
  }
  return { winner, picksGraded: gradedCount };
}
