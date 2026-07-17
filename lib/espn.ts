// Thin client around ESPN's public (unofficial, unauthenticated) scoreboard
// and rankings endpoints. No API key needed. These are the same JSON feeds
// that power espn.com's scoreboard pages.
//
// These endpoints are unofficial and can change or rate-limit without
// notice, and a few of the parameter conventions below (notably CFB
// "Week 0" handling) are based on documented community usage rather than
// something verifiable from this sandbox (it has no network access to
// test against). If a specific slate looks off once you're running this
// for real, the fix is almost always a tweak to the query params in this
// file — the rest of the app doesn't care where the data comes from.

export type NormalizedGame = {
  espnEventId: string;
  homeTeam: string;
  awayTeam: string;
  homeTeamAbbr: string;
  awayTeamAbbr: string;
  startTime: string; // ISO
  status: "scheduled" | "in_progress" | "final";
  homeScore: number | null;
  awayScore: number | null;
  winner: "home" | "away" | "tie" | null;
  homeLogo: string | null;
  awayLogo: string | null;
  homeLogoThrowback: string | null;
  awayLogoThrowback: string | null;
  homeRecord: string | null;
  awayRecord: string | null;
  notes: string[]; // e.g. ["Rose Bowl", "Big Ten Championship"]
};

const SPORT_PATHS: Record<string, string> = {
  NFL: "football/nfl",
  CFB: "football/college-football",
};

function mapStatus(state: string): NormalizedGame["status"] {
  if (state === "post") return "final";
  if (state === "in") return "in_progress";
  return "scheduled";
}

function pickLogo(team: any): { default: string | null; throwback: string | null } {
  const logos: any[] = team?.logos ?? [];
  if (logos.length === 0) return { default: team?.logo ?? null, throwback: null };

  const byRel = (needle: string) => logos.find((l) => (l.rel ?? []).some((r: string) => r.toLowerCase().includes(needle)));

  // ESPN doesn't consistently label a "throwback" logo for every team. We
  // look for anything tagged throwback/alternate/historic first; if that
  // isn't present for a given team, throwback falls back to null and the
  // UI should fall back to the default logo.
  const throwback = byRel("throwback") ?? byRel("alternate") ?? byRel("historic") ?? null;
  const primary = byRel("default") ?? logos[0];

  return {
    default: primary?.href ?? team?.logo ?? null,
    throwback: throwback?.href ?? null,
  };
}

function recordSummary(competitor: any): string | null {
  const records: any[] = competitor?.records ?? [];
  const total = records.find((r) => r.type === "total") ?? records[0];
  return total?.summary ?? null;
}

/**
 * Fetch a scoreboard slate.
 *
 * NFL: `seasontype` 2 = regular season (weeks 1-18), 3 = postseason
 * (week 1 = wild card ... week 5 = Super Bowl).
 *
 * CFB: `seasontype` 1 = week 0 / preseason slate, 2 = regular season
 * (weeks 1-15ish), 3 = postseason (conference championships + bowls,
 * typically returned across a small range of weeks — pass week=1 for a
 * combined postseason slate, ESPN groups most bowls under one week).
 */
export async function fetchScoreboard(
  sport: "NFL" | "CFB",
  opts: { week: number; year: number; seasontype?: number }
): Promise<NormalizedGame[]> {
  const path = SPORT_PATHS[sport];
  const seasontype = opts.seasontype ?? 2;
  const url = `https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard?week=${opts.week}&year=${opts.year}&seasontype=${seasontype}&limit=400`;

  const res = await fetch(url, { next: { revalidate: 0 } });
  if (!res.ok) {
    throw new Error(`ESPN scoreboard fetch failed (${res.status}): ${url}`);
  }
  const data = await res.json();

  const events = data.events ?? [];

  // ESPN's week/year/seasontype scoreboard params occasionally fall back
  // to the most recent *completed* season instead of erroring when the
  // requested season's week-grouping isn't fully populated on their end
  // yet (this can happen well before a season starts, even once the
  // schedule itself is public). Rather than silently importing the wrong
  // season's games, bail loudly so it's obvious what happened.
  if (events.length > 0) {
    const returnedYears = new Set(events.map((e: any) => new Date(e.date).getFullYear()));
    const expectedYears = new Set([opts.year, opts.year + 1]); // a season spans two calendar years
    const allMismatched = [...returnedYears].every((y) => !expectedYears.has(y as number));
    if (allMismatched) {
      throw new Error(
        `ESPN returned games from ${[...returnedYears].join("/")} instead of the requested ${opts.year} season — ` +
          `it likely hasn't activated week-based indexing for that season yet. Try "Sync by date range" instead.`
      );
    }
  }

  const games: NormalizedGame[] = events.map((event: any) => {
    const competition = event.competitions[0];
    const competitors = competition.competitors;
    const home = competitors.find((c: any) => c.homeAway === "home");
    const away = competitors.find((c: any) => c.homeAway === "away");
    const state: string = competition.status.type.state; // "pre" | "in" | "post"
    const status = mapStatus(state);

    let winner: NormalizedGame["winner"] = null;
    if (status === "final") {
      if (home.winner) winner = "home";
      else if (away.winner) winner = "away";
      else winner = "tie";
    }

    const homeLogos = pickLogo(home.team);
    const awayLogos = pickLogo(away.team);
    const notes: string[] = (competition.notes ?? []).map((n: any) => n.headline).filter(Boolean);

    return {
      espnEventId: event.id,
      homeTeam: home.team.displayName,
      awayTeam: away.team.displayName,
      homeTeamAbbr: home.team.abbreviation,
      awayTeamAbbr: away.team.abbreviation,
      startTime: event.date,
      status,
      homeScore: home.score != null ? Number(home.score) : null,
      awayScore: away.score != null ? Number(away.score) : null,
      winner,
      homeLogo: homeLogos.default,
      awayLogo: awayLogos.default,
      homeLogoThrowback: homeLogos.throwback,
      awayLogoThrowback: awayLogos.throwback,
      homeRecord: recordSummary(home),
      awayRecord: recordSummary(away),
      notes,
    };
  });

  return games;
}

/**
 * Same as fetchScoreboard, but pinned to a specific calendar date (or date
 * range, e.g. "20260903-20260909") instead of an ESPN week number. This is
 * the reliable fallback when week/year/seasontype lookups silently return
 * the wrong season (see the check in fetchScoreboard) — ESPN's date-based
 * lookup doesn't depend on that internal week-indexing being ready.
 *
 * ESPN's `dates=` param isn't always a hard boundary — for CFB especially,
 * it can return games outside the requested range. Results are filtered
 * client-side against the requested range as a hard cutoff, so this
 * function's output always matches what you asked for even if ESPN's
 * response didn't.
 */
export async function fetchScoreboardByDate(sport: "NFL" | "CFB", dateYYYYMMDD: string): Promise<NormalizedGame[]> {
  const path = SPORT_PATHS[sport];
  const url = `https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard?dates=${dateYYYYMMDD}&limit=400`;

  const res = await fetch(url, { next: { revalidate: 0 } });
  if (!res.ok) throw new Error(`ESPN scoreboard fetch failed (${res.status}): ${url}`);
  const data = await res.json();

  const { start, end } = parseDateRangeBounds(dateYYYYMMDD);

  const events = data.events ?? [];
  const games = events.map((event: any) => {
    const competition = event.competitions[0];
    const competitors = competition.competitors;
    const home = competitors.find((c: any) => c.homeAway === "home");
    const away = competitors.find((c: any) => c.homeAway === "away");
    const state: string = competition.status.type.state;
    const status = mapStatus(state);

    let winner: NormalizedGame["winner"] = null;
    if (status === "final") {
      if (home.winner) winner = "home";
      else if (away.winner) winner = "away";
      else winner = "tie";
    }

    const homeLogos = pickLogo(home.team);
    const awayLogos = pickLogo(away.team);
    const notes: string[] = (competition.notes ?? []).map((n: any) => n.headline).filter(Boolean);

    return {
      espnEventId: event.id,
      homeTeam: home.team.displayName,
      awayTeam: away.team.displayName,
      homeTeamAbbr: home.team.abbreviation,
      awayTeamAbbr: away.team.abbreviation,
      startTime: event.date,
      status,
      homeScore: home.score != null ? Number(home.score) : null,
      awayScore: away.score != null ? Number(away.score) : null,
      winner,
      homeLogo: homeLogos.default,
      awayLogo: awayLogos.default,
      homeLogoThrowback: homeLogos.throwback,
      awayLogoThrowback: awayLogos.throwback,
      homeRecord: recordSummary(home),
      awayRecord: recordSummary(away),
      notes,
    };
  });

  return games.filter((g: NormalizedGame) => {
    const t = new Date(g.startTime).getTime();
    return t >= start.getTime() && t <= end.getTime();
  });
}

/**
 * Parses "YYYYMMDD" or "YYYYMMDD-YYYYMMDD" into inclusive UTC day
 * boundaries, with a buffer on each side: ESPN's `startTime` is UTC, but
 * the calendar date a fan means is US-local — an 8pm PT kickoff on the
 * "end" date lands after midnight UTC the *next* day. The buffer keeps
 * that game in range without meaningfully weakening the cutoff for games
 * that are genuinely outside the requested window.
 */
export function parseDateRangeBounds(dateYYYYMMDD: string): { start: Date; end: Date } {
  const [startStr, endStr] = dateYYYYMMDD.split("-");
  const toDate = (s: string) => {
    const year = Number(s.slice(0, 4));
    const month = Number(s.slice(4, 6)) - 1;
    const day = Number(s.slice(6, 8));
    return { year, month, day };
  };
  const startParts = toDate(startStr);
  const endParts = toDate(endStr ?? startStr);
  const HOUR = 60 * 60 * 1000;
  return {
    start: new Date(Date.UTC(startParts.year, startParts.month, startParts.day, 0, 0, 0, 0) - 10 * HOUR),
    end: new Date(Date.UTC(endParts.year, endParts.month, endParts.day, 23, 59, 59, 999) + 14 * HOUR),
  };
}

export type RankingEntry = { teamAbbr: string; rank: number };

/**
 * Fetch the AP Top 25 for a given CFB week. Returns a lookup you can use to
 * tag games where either team is ranked.
 */
export async function fetchApPoll(opts: { week: number; year: number; seasontype?: number }): Promise<Map<string, number>> {
  const seasontype = opts.seasontype ?? 2;
  const url = `https://site.api.espn.com/apis/site/v2/sports/football/college-football/rankings?week=${opts.week}&year=${opts.year}&seasontype=${seasontype}`;

  const res = await fetch(url, { next: { revalidate: 0 } });
  if (!res.ok) throw new Error(`ESPN rankings fetch failed (${res.status}): ${url}`);
  const data = await res.json();

  const polls: any[] = data.rankings ?? [];
  const ap = polls.find((p) => /ap top 25|associated press/i.test(p.name ?? p.shortName ?? "")) ?? polls[0];
  if (!ap) return new Map();

  const map = new Map<string, number>();
  for (const entry of ap.ranks ?? []) {
    const abbr = entry.team?.abbreviation;
    if (abbr) map.set(abbr, entry.current);
  }
  return map;
}

/** Best-effort guess at the current NFL/CFB week number for a given date. */
/** Week 0's anchor date for a given season — single source of truth, used both to fetch Week 0 and to exclude its games from every other CFB sync. */
export function cfbWeek0DateBounds(season: number): { start: Date; end: Date } {
  return parseDateRangeBounds(`${season}0829`);
}

export function currentSeasonYear(date = new Date()): number {
  // NFL/CFB seasons span Aug (year Y) - Feb (year Y+1); label by the year the
  // season started.
  const month = date.getMonth(); // 0-11
  return month < 2 ? date.getFullYear() - 1 : date.getFullYear();
}

/** Week ranges to loop over for a "sync everything" pass. */
export const SEASON_STRUCTURE = {
  NFL: {
    // regular season weeks 1-18, postseason weeks 1-5 (wildcard..Super Bowl)
    regularWeeks: Array.from({ length: 18 }, (_, i) => i + 1),
    postseasonWeeks: [1, 2, 3, 4, 5],
  },
  CFB: {
    // Week 0 is synced separately by calendar date (see syncCfbWeek0), and
    // postseason (conference championships, bowls, CFB playoff rounds) is
    // synced separately too (see syncCfbPostseason), since it needs to
    // scan and categorize games rather than trust ESPN's week numbering.
    regularWeeks: Array.from({ length: 15 }, (_, i) => i + 1),
  },
};
