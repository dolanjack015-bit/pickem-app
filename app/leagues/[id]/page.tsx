"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { currentSeasonYear } from "@/lib/espn";

type Game = {
  id: string;
  homeTeam: string;
  awayTeam: string;
  homeTeamAbbr: string;
  awayTeamAbbr: string;
  startTime: string;
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
  homeRank: number | null;
  awayRank: number | null;
  gameLabel: string | null;
  isManual: boolean;
  locked: boolean;
  myPick: "home" | "away" | null;
  picks: { username: string; pickedTeam: string; isCorrect: boolean | null }[];
};

type LeagueInfo = { id: string; name: string; sport: string; inviteCode: string; role: string };
type LeaderboardRow = { userId: string; username: string; correct: number; incorrect: number; totalPicks: number; winPct: number };
type PickHistoryRow = {
  gameId: string;
  weekLabel: string;
  sport: string;
  gameLabel: string | null;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  pickedTeam: "home" | "away";
  pickedTeamName: string;
  isCorrect: boolean | null;
  status: string;
  startTime: string;
};

const SEASON_TYPES = [
  { value: 1, label: "Week 0 / Preseason" },
  { value: 2, label: "Regular Season" },
  { value: 3, label: "Postseason (Bowls / Playoffs)" },
];

// Mirrors CFB_POSTSEASON_ROUND_LABELS in lib/sync.ts — duplicated here
// (rather than imported) because lib/sync.ts pulls in the Prisma client,
// which can't be bundled into client-side code.
const CFB_POSTSEASON_ROUND_LABELS: Record<number, string> = {
  1: "Conference Championships",
  2: "Bowl Season",
  3: "CFB Playoff: First Round",
  4: "CFB Playoff: Quarterfinal",
  5: "CFB Playoff: Semifinal",
  6: "CFB Playoff: National Championship",
};

/** Parses a fetch Response as JSON, falling back gracefully if the body is empty or malformed (e.g. a crashed route). */
async function safeJson(res: Response): Promise<any> {
  const text = await res.text();
  if (!text) return { error: `Server returned an empty response (status ${res.status})` };
  try {
    return JSON.parse(text);
  } catch {
    return { error: `Server returned an unexpected response (status ${res.status})` };
  }
}

export default function LeagueDetailPage({ params }: { params: { id: string } }) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [league, setLeague] = useState<LeagueInfo | null>(null);
  const [members, setMembers] = useState<{ userId: string; username: string; role: string }[]>([]);
  const [sport, setSport] = useState("NFL");
  const [season, setSeason] = useState(currentSeasonYear());
  const [weekNumber, setWeekNumber] = useState(1);
  const [seasonType, setSeasonType] = useState(2);
  const [games, setGames] = useState<Game[]>([]);
  const [picksLockAt, setPicksLockAt] = useState<string | null>(null);
  const [currentWeekId, setCurrentWeekId] = useState<string | null>(null);
  const [refreshingScores, setRefreshingScores] = useState(false);
  const [leaderboards, setLeaderboards] = useState<Record<string, LeaderboardRow[]>>({
    ALL: [],
    NFL: [],
    CFB: [],
    FANTASY: [],
  });
  const [weeklyLeaderboard, setWeeklyLeaderboard] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [fantasyHome, setFantasyHome] = useState("");
  const [fantasyAway, setFantasyAway] = useState("");
  const [fantasyLockTime, setFantasyLockTime] = useState(() => {
    const d = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000); // default: 3 days out
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  });
  const [showDateFallback, setShowDateFallback] = useState(false);
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [showArchive, setShowArchive] = useState(false);
  const [archiveUserId, setArchiveUserId] = useState<string | null>(null); // null = "me"
  const [archiveSport, setArchiveSport] = useState("ALL");
  const [archiveRows, setArchiveRows] = useState<PickHistoryRow[]>([]);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [cfbAllGames, setCfbAllGames] = useState(false);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status, router]);

  const loadLeague = useCallback(async () => {
    const res = await fetch(`/api/leagues/${params.id}`);
    if (res.ok) {
      const data = await res.json();
      setLeague(data);
      if (data.sport !== "BOTH") setSport(data.sport);
    }
  }, [params.id]);

  const loadWeek = useCallback(async () => {
    setLoading(true);
    const res = await fetch(
      `/api/leagues/${params.id}/week?sport=${sport}&season=${season}&weekNumber=${weekNumber}&seasonType=${seasonType}`
    );
    if (res.ok) {
      const data = await res.json();
      setGames(data.games ?? []);
      setPicksLockAt(data.picksLockAt ?? null);
      setCurrentWeekId(data.weekId ?? null);
    }
    setLoading(false);
  }, [params.id, sport, season, weekNumber, seasonType]);

  const loadLeaderboard = useCallback(async () => {
    const sports = ["ALL", "NFL", "CFB", "FANTASY"];
    const results = await Promise.all(
      sports.map(async (s) => {
        const res = await fetch(`/api/leagues/${params.id}/leaderboard?sport=${s}`);
        return [s, res.ok ? await res.json() : []] as const;
      })
    );
    setLeaderboards(Object.fromEntries(results));
  }, [params.id]);

  const loadMembers = useCallback(async () => {
    const res = await fetch(`/api/leagues/${params.id}/members`);
    if (res.ok) setMembers(await res.json());
  }, [params.id]);

  const loadWeeklyLeaderboard = useCallback(async () => {
    const res = await fetch(
      `/api/leagues/${params.id}/leaderboard?sport=${sport}&season=${season}&weekNumber=${weekNumber}&seasonType=${seasonType}`
    );
    setWeeklyLeaderboard(res.ok ? await res.json() : []);
  }, [params.id, sport, season, weekNumber, seasonType]);

  useEffect(() => {
    if (status === "authenticated") {
      loadLeague();
      loadLeaderboard();
      loadMembers();
    }
  }, [status, loadLeague, loadLeaderboard, loadMembers]);

  useEffect(() => {
    if (status === "authenticated") loadWeek();
  }, [status, loadWeek]);

  useEffect(() => {
    if (status === "authenticated") loadWeeklyLeaderboard();
  }, [status, loadWeeklyLeaderboard]);

  const loadArchive = useCallback(async () => {
    setArchiveLoading(true);
    const uid = archiveUserId ?? (session?.user as any)?.id;
    const res = await fetch(`/api/leagues/${params.id}/picks?sport=${archiveSport}${uid ? `&userId=${uid}` : ""}`);
    setArchiveRows(res.ok ? await res.json() : []);
    setArchiveLoading(false);
  }, [params.id, archiveUserId, archiveSport, session]);

  useEffect(() => {
    if (status === "authenticated" && showArchive) loadArchive();
  }, [status, showArchive, loadArchive]);

  async function handleRefreshScores() {
    if (!currentWeekId) {
      setMessage("Nothing to refresh yet — this week hasn't been set up by the league owner.");
      return;
    }
    setRefreshingScores(true);
    setMessage(null);
    const res = await fetch(`/api/leagues/${params.id}/refresh-scores`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weekId: currentWeekId }),
    });
    const data = await safeJson(res);
    if (res.ok) {
      setMessage(`Refreshed ${data.gamesUpdated} game${data.gamesUpdated === 1 ? "" : "s"}, graded ${data.picksGraded} pick${data.picksGraded === 1 ? "" : "s"}.`);
      await loadWeek();
      await loadLeaderboard();
      await loadWeeklyLeaderboard();
    } else {
      setMessage(data.error || "Refresh failed");
    }
    setRefreshingScores(false);
  }

  async function handleSync() {
    setSyncing(true);
    setMessage(null);
    const res = await fetch(`/api/leagues/${params.id}/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sport, season, weekNumber, seasonType, allGames: cfbAllGames }),
    });
    const data = await safeJson(res);
    if (res.ok) {
      setMessage(`Synced ${data.gamesSaved} of ${data.gamesFromEspn} games, graded ${data.picksGraded} picks.`);
      await loadWeek();
      await loadLeaderboard();
      await loadWeeklyLeaderboard();
    } else {
      setMessage(data.error || "Sync failed");
      if (data.error?.includes("Sync by date range")) setShowDateFallback(true);
    }
    setSyncing(false);
  }

  async function handleSyncByDate() {
    if (!dateStart) return;
    setSyncing(true);
    setMessage(null);
    const dateRange = dateEnd ? `${dateStart.replace(/-/g, "")}-${dateEnd.replace(/-/g, "")}` : dateStart.replace(/-/g, "");
    const res = await fetch(`/api/leagues/${params.id}/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sport, season, weekNumber, seasonType, dateRange, allGames: cfbAllGames }),
    });
    const data = await safeJson(res);
    if (res.ok) {
      setMessage(`Synced ${data.gamesSaved} of ${data.gamesFromEspn} games (by date), graded ${data.picksGraded} picks.`);
      await loadWeek();
      await loadLeaderboard();
      await loadWeeklyLeaderboard();
    } else {
      setMessage(data.error || "Sync by date failed");
    }
    setSyncing(false);
  }

  async function handleSyncFullSeason() {
    if (!confirm(`This pulls the ENTIRE ${sport} ${season} season from ESPN — dozens of requests, may take a while. Continue?`)) return;
    setSyncing(true);
    setMessage("Syncing full season, this can take a minute or two...");
    const res = await fetch(`/api/leagues/${params.id}/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sport, season, full: true, allGames: cfbAllGames }),
    });
    const data = await safeJson(res);
    if (res.ok) {
      const failedNote =
        data.weeksFailed > 0
          ? ` ${data.weeksFailed} week${data.weeksFailed === 1 ? "" : "s"} couldn't be synced by week number (ESPN reliability issue) — sync ${data.weeksFailed === 1 ? "it" : "those"} individually using "Sync by exact date": weeks ${data.errors?.map((e: any) => e.weekNumber).join(", ")}.`
          : "";
      setMessage(`Synced ${data.weeksSynced} weeks, ${data.gamesSaved} games, graded ${data.picksGraded} picks.${failedNote}`);
      await loadWeek();
      await loadLeaderboard();
      await loadWeeklyLeaderboard();
    } else {
      setMessage(data.error || "Full season sync failed");
    }
    setSyncing(false);
  }

  async function handleRemoveMember(userId: string, isSelf: boolean) {
    if (!confirm(isSelf ? "Leave this league?" : "Remove this member from the league?")) return;
    const res = await fetch(`/api/leagues/${params.id}/members/${userId}`, { method: "DELETE" });
    if (res.ok) {
      if (isSelf) {
        router.push("/leagues");
      } else {
        await loadMembers();
      }
    } else {
      const data = await res.json();
      setMessage(data.error);
    }
  }

  async function handleDeleteLeague() {
    if (!confirm(`Permanently delete "${league?.name}"? This removes all weeks, games, and everyone's picks. This can't be undone.`)) return;
    const res = await fetch(`/api/leagues/${params.id}`, { method: "DELETE" });
    if (res.ok) {
      router.push("/leagues");
    } else {
      const data = await res.json();
      setMessage(data.error);
    }
  }

  async function handleAddFantasyGame(e: React.FormEvent) {
    e.preventDefault();
    if (!fantasyHome.trim() || !fantasyAway.trim()) return;
    const res = await fetch(`/api/leagues/${params.id}/fantasy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ season, weekNumber, homeTeam: fantasyHome, awayTeam: fantasyAway, startTime: fantasyLockTime }),
    });
    if (res.ok) {
      setFantasyHome("");
      setFantasyAway("");
      await loadWeek();
    } else {
      const data = await res.json();
      setMessage(data.error);
    }
  }

  async function handleSetFantasyScore(gameId: string, homeScore: number, awayScore: number) {
    const res = await fetch(`/api/leagues/${params.id}/fantasy/${gameId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ homeScore, awayScore }),
    });
    if (res.ok) {
      await loadWeek();
      await loadLeaderboard();
      await loadWeeklyLeaderboard();
    } else {
      const data = await res.json();
      setMessage(data.error);
    }
  }

  async function handleDeleteFantasyGame(gameId: string) {
    if (!confirm("Remove this matchup and everyone's picks for it?")) return;
    const res = await fetch(`/api/leagues/${params.id}/fantasy/${gameId}`, { method: "DELETE" });
    if (res.ok) {
      await loadWeek();
      await loadLeaderboard();
      await loadWeeklyLeaderboard();
    }
  }

  async function handlePick(gameId: string, pickedTeam: "home" | "away") {
    const res = await fetch("/api/picks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gameId, pickedTeam }),
    });
    if (res.ok) {
      await loadWeek();
    } else {
      const data = await res.json();
      setMessage(data.error);
    }
  }

  if (status !== "authenticated") return null;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl">{league?.name ?? "League"}</h1>
          {league && <p className="text-white/50 text-sm">Invite code: {league.inviteCode}</p>}
        </div>
        <div className="flex gap-2">
          {league?.role === "owner" && (
            <button
              onClick={handleDeleteLeague}
              className="px-4 py-2 rounded-lg border border-red-400/40 text-red-400 hover:bg-red-400/10 transition-colors text-sm"
            >
              Delete league
            </button>
          )}
          {sport !== "FANTASY" && (
            <button
              onClick={handleRefreshScores}
              disabled={refreshingScores || !currentWeekId}
              className="px-4 py-2 rounded-lg border border-white/20 hover:border-white/40 transition-colors text-sm disabled:opacity-50"
              title="Updates scores on games already set for this week — doesn't add or remove any games"
            >
              {refreshingScores ? "Refreshing..." : "Refresh scores"}
            </button>
          )}
          {sport !== "FANTASY" && league?.role === "owner" && (
            <>
              <button onClick={handleSync} disabled={syncing} className="btn-primary" title="Sets/changes which games are in this week — owner only">
                {syncing ? "Syncing..." : "Sync this week"}
              </button>
              <button
                onClick={handleSyncFullSeason}
                disabled={syncing}
                className="px-4 py-2 rounded-lg border border-white/20 hover:border-white/40 transition-colors text-sm disabled:opacity-50"
              >
                Sync full season
              </button>
            </>
          )}
        </div>
      </div>

      {sport !== "FANTASY" && league?.role !== "owner" && (
        <p className="text-xs text-white/40 -mt-6">
          Only the league owner sets which games are up for picks each week. You can refresh scores any time — it won't
          change what's already been picked.
        </p>
      )}

      <div className="card p-4 flex flex-wrap gap-3 items-end">
        <label className="flex flex-col text-sm gap-1">
          Sport
          <select className="bg-black/20 border border-white/15 rounded-lg px-3 py-2" value={sport} onChange={(e) => setSport(e.target.value)}>
            <option value="NFL">NFL</option>
            <option value="CFB">College Football</option>
            <option value="FANTASY">Fantasy Football</option>
          </select>
        </label>
        <label className="flex flex-col text-sm gap-1">
          Season
          <input
            type="number"
            className="bg-black/20 border border-white/15 rounded-lg px-3 py-2 w-24"
            value={season}
            onChange={(e) => setSeason(Number(e.target.value))}
          />
        </label>
        {sport !== "FANTASY" && (
          <label className="flex flex-col text-sm gap-1">
            Slate
            <select
              className="bg-black/20 border border-white/15 rounded-lg px-3 py-2"
              value={seasonType}
              onChange={(e) => setSeasonType(Number(e.target.value))}
            >
              {SEASON_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex flex-col text-sm gap-1">
          {sport === "CFB" && seasonType === 3 ? "Round" : "Week"}
          {sport === "CFB" && seasonType === 3 ? (
            <select
              className="bg-black/20 border border-white/15 rounded-lg px-3 py-2"
              value={weekNumber}
              onChange={(e) => setWeekNumber(Number(e.target.value))}
            >
              {Object.entries(CFB_POSTSEASON_ROUND_LABELS).map(([num, label]) => (
                <option key={num} value={num}>
                  {label}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="number"
              min={0}
              max={20}
              className="bg-black/20 border border-white/15 rounded-lg px-3 py-2 w-20"
              value={weekNumber}
              onChange={(e) => setWeekNumber(Number(e.target.value))}
            />
          )}
        </label>
      </div>

      {sport === "CFB" && seasonType === 3 && (
        <p className="text-xs text-white/40 -mt-4">
          Postseason syncs all rounds at once — conference championships, regular bowls, and each CFB Playoff round
          (First Round, Quarterfinal, Semifinal, National Championship) each land in their own week, same as NFL
          playoff rounds. Pick a round above just to view it; syncing pulls all of them.
        </p>
      )}

      {sport === "CFB" && seasonType === 2 && league?.role === "owner" && (
        <label className="flex items-center gap-2 text-sm -mt-4 self-start">
          <input type="checkbox" checked={cfbAllGames} onChange={(e) => setCfbAllGames(e.target.checked)} className="w-4 h-4" />
          Sync every game this week (not just AP-ranked matchups)
        </label>
      )}

      {sport === "CFB" && seasonType !== 3 && (
        <p className="text-xs text-white/40 -mt-4">
          {cfbAllGames
            ? "Every regular-season game this week will be synced, ranked or not."
            : "Regular-season slates only show AP-ranked matchups (plus Army-Navy). Week 0 includes every game."}
        </p>
      )}

      {sport === "FANTASY" && (
        <form onSubmit={handleAddFantasyGame} className="card p-4 flex flex-wrap gap-3 items-end">
          <label className="flex flex-col text-sm gap-1 flex-1 min-w-[160px]">
            Team A (away)
            <input
              className="bg-black/20 border border-white/15 rounded-lg px-3 py-2"
              placeholder="e.g. Jordan's Juggernauts"
              value={fantasyAway}
              onChange={(e) => setFantasyAway(e.target.value)}
            />
          </label>
          <label className="flex flex-col text-sm gap-1 flex-1 min-w-[160px]">
            Team B (home)
            <input
              className="bg-black/20 border border-white/15 rounded-lg px-3 py-2"
              placeholder="e.g. Priya's Powerhouse"
              value={fantasyHome}
              onChange={(e) => setFantasyHome(e.target.value)}
            />
          </label>
          <label className="flex flex-col text-sm gap-1">
            Picks lock at
            <input
              type="datetime-local"
              className="bg-black/20 border border-white/15 rounded-lg px-3 py-2"
              value={fantasyLockTime}
              onChange={(e) => setFantasyLockTime(e.target.value)}
            />
          </label>
          <button className="btn-primary">Add matchup to Week {weekNumber}</button>
        </form>
      )}

      {message && <p className="text-sm text-pigskin">{message}</p>}

      {sport !== "FANTASY" && league?.role === "owner" && (
        <button onClick={() => setShowDateFallback((v) => !v)} className="text-xs text-white/40 hover:text-white/70 transition-colors -mt-4 self-start text-left">
          {showDateFallback
            ? "Hide"
            : sport === "CFB"
            ? "CFB week numbers from ESPN aren't always reliable — sync by exact date instead →"
            : "Week/season lookup returning the wrong season? Sync by exact date instead →"}
        </button>
      )}

      {showDateFallback && sport !== "FANTASY" && league?.role === "owner" && (
        <div className="card p-4 flex flex-wrap gap-3 items-end">
          <p className="text-xs text-white/50 basis-full">
            {sport === "CFB"
              ? "ESPN's \"week\" grouping for CFB doesn't always match the actual game dates — it can pull in extra games or miss the exact window. Syncing by exact date is the more reliable option for CFB regular-season weeks: enter the real date range for this week (e.g. the Wednesday/Thursday through Monday it covers), and it'll save under Season " +
                season +
                ", Week " +
                weekNumber +
                " regardless. Week 0-dated games (Aug 29) are automatically excluded even if ESPN's response includes them."
              : "Use this if the sync error mentions ESPN returning the wrong season. Pull games for Week " +
                weekNumber +
                " by their actual calendar dates instead of ESPN's week number — they'll still be saved under Season " +
                season +
                ", Week " +
                weekNumber +
                "."}
          </p>
          <label className="flex flex-col text-sm gap-1">
            Start date
            <input type="date" className="bg-black/20 border border-white/15 rounded-lg px-3 py-2" value={dateStart} onChange={(e) => setDateStart(e.target.value)} />
          </label>
          <label className="flex flex-col text-sm gap-1">
            End date (optional)
            <input type="date" className="bg-black/20 border border-white/15 rounded-lg px-3 py-2" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} />
          </label>
          <button onClick={handleSyncByDate} disabled={syncing || !dateStart} className="btn-primary disabled:opacity-50">
            Sync by date
          </button>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2 className="font-display text-xl">Matchups</h2>
          {sport !== "FANTASY" && picksLockAt && (
            <span className="text-xs text-white/50">
              {new Date(picksLockAt).getTime() > Date.now() ? "Picks lock" : "Picks locked"} at {new Date(picksLockAt).toLocaleString()}
              {" "}(kickoff of the week&rsquo;s first game)
            </span>
          )}
        </div>
        {loading ? (
          <p className="text-white/60">Loading...</p>
        ) : games.length === 0 ? (
          <p className="text-white/60">
            {sport === "FANTASY" ? (
              "No matchups added for this week yet. Use the form above to add one."
            ) : league?.role === "owner" ? (
              <>
                No games loaded for this slate yet. Click <strong>Sync this week</strong> (or <strong>Sync full season</strong>) to pull it from ESPN.
              </>
            ) : (
              "The league owner hasn't set up this week's matchups yet — check back soon."
            )}
          </p>
        ) : (
          <div className="grid sm:grid-cols-2 gap-4">
            {games.map((g) => (
              <GameCard key={g.id} game={g} sport={sport} onPick={handlePick} onSetScore={handleSetFantasyScore} onDelete={handleDeleteFantasyGame} />
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="font-display text-xl mb-3">
          This Week&rsquo;s Leaderboard{sport === "CFB" && seasonType === 3 ? ` — ${CFB_POSTSEASON_ROUND_LABELS[weekNumber] ?? ""}` : ` — Week ${weekNumber}`}
        </h2>
        <WeeklyLeaderboardTable rows={weeklyLeaderboard} />
      </div>

      <div>
        <h2 className="font-display text-xl mb-3">Members</h2>
        <div className="card p-4 flex flex-wrap gap-2">
          {members.map((m) => {
            const isSelf = m.userId === (session?.user as any)?.id;
            const canRemove = isSelf ? m.role !== "owner" : league?.role === "owner" && m.role !== "owner";
            return (
              <span key={m.userId} className="flex items-center gap-2 bg-black/20 border border-white/15 rounded-full pl-3 pr-1.5 py-1 text-sm">
                {m.username}
                {m.role === "owner" && <span className="text-pigskin text-xs">owner</span>}
                {canRemove && (
                  <button
                    onClick={() => handleRemoveMember(m.userId, isSelf)}
                    className="w-5 h-5 rounded-full hover:bg-red-400/20 text-white/50 hover:text-red-400 transition-colors text-xs"
                    title={isSelf ? "Leave league" : "Remove member"}
                  >
                    ✕
                  </button>
                )}
              </span>
            );
          })}
        </div>
      </div>

      <div>
        <h2 className="font-display text-xl mb-3">Season Leaderboards</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <LeaderboardTable title="Overall" rows={leaderboards.ALL} />
          <LeaderboardTable title="NFL" rows={leaderboards.NFL} />
          <LeaderboardTable title="College Football" rows={leaderboards.CFB} />
          <LeaderboardTable title="Fantasy Football" rows={leaderboards.FANTASY} />
        </div>
      </div>

      <div>
        <button onClick={() => setShowArchive((v) => !v)} className="font-display text-xl mb-3 hover:text-pigskin transition-colors">
          Pick Archive {showArchive ? "▾" : "▸"}
        </button>
        {showArchive && (
          <div className="flex flex-col gap-3">
            <div className="card p-4 flex flex-wrap gap-3 items-end">
              <label className="flex flex-col text-sm gap-1">
                Player
                <select
                  className="bg-black/20 border border-white/15 rounded-lg px-3 py-2"
                  value={archiveUserId ?? ""}
                  onChange={(e) => setArchiveUserId(e.target.value || null)}
                >
                  <option value="">Me</option>
                  {members
                    .filter((m) => m.userId !== (session?.user as any)?.id)
                    .map((m) => (
                      <option key={m.userId} value={m.userId}>
                        {m.username}
                      </option>
                    ))}
                </select>
              </label>
              <label className="flex flex-col text-sm gap-1">
                Sport
                <select className="bg-black/20 border border-white/15 rounded-lg px-3 py-2" value={archiveSport} onChange={(e) => setArchiveSport(e.target.value)}>
                  <option value="ALL">All</option>
                  <option value="NFL">NFL</option>
                  <option value="CFB">College Football</option>
                  <option value="FANTASY">Fantasy</option>
                </select>
              </label>
              {archiveUserId && (
                <p className="text-xs text-white/40 basis-full">
                  Showing only picks on games that have already started — a teammate's future picks stay hidden until kickoff.
                </p>
              )}
            </div>

            <div className="card overflow-hidden">
              {archiveLoading ? (
                <p className="text-white/40 text-xs px-4 py-4">Loading...</p>
              ) : archiveRows.length === 0 ? (
                <p className="text-white/40 text-xs px-4 py-4">No picks found for this filter yet.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-white/5 text-left">
                    <tr>
                      <th className="px-4 py-2">Week</th>
                      <th className="px-4 py-2">Matchup</th>
                      <th className="px-4 py-2">Pick</th>
                      <th className="px-4 py-2">Result</th>
                      <th className="px-4 py-2">Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {archiveRows.map((r) => (
                      <tr key={r.gameId} className="border-t border-white/10">
                        <td className="px-4 py-2 whitespace-nowrap">
                          {r.weekLabel}
                          {r.gameLabel && <div className="text-[10px] text-white/40">{r.gameLabel}</div>}
                        </td>
                        <td className="px-4 py-2">
                          {r.awayTeam} @ {r.homeTeam}
                        </td>
                        <td className="px-4 py-2">{r.pickedTeamName}</td>
                        <td className="px-4 py-2">
                          {r.isCorrect === true && <span className="text-green-400">Correct</span>}
                          {r.isCorrect === false && <span className="text-red-400">Incorrect</span>}
                          {r.isCorrect === null && <span className="text-white/40">{r.status === "scheduled" ? "Pending" : "Ungraded"}</span>}
                        </td>
                        <td className="px-4 py-2 text-white/50">
                          {r.homeScore !== null && r.awayScore !== null ? `${r.awayScore}–${r.homeScore}` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function LeaderboardTable({ title, rows }: { title: string; rows: LeaderboardRow[] }) {
  return (
    <div className="card overflow-hidden">
      <h3 className="font-semibold px-4 pt-3 pb-1 text-sm text-white/80">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-white/40 text-xs px-4 pb-4">No graded picks yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-white/5 text-left">
            <tr>
              <th className="px-4 py-2">Rank</th>
              <th className="px-4 py-2">Player</th>
              <th className="px-4 py-2">Correct</th>
              <th className="px-4 py-2">Incorrect</th>
              <th className="px-4 py-2">Win %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row.userId} className="border-t border-white/10">
                <td className="px-4 py-2">{i + 1}</td>
                <td className="px-4 py-2">{row.username}</td>
                <td className="px-4 py-2">{row.correct}</td>
                <td className="px-4 py-2">{row.incorrect}</td>
                <td className="px-4 py-2">{row.winPct}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/**
 * Same shape as LeaderboardTable, but scoped to a single week and with the
 * week's leader(s) called out — this is "who won this week," as opposed
 * to the season-long standings.
 */
function WeeklyLeaderboardTable({ rows }: { rows: LeaderboardRow[] }) {
  const graded = rows.filter((r) => r.correct + r.incorrect > 0);
  const topScore = graded.length > 0 ? Math.max(...graded.map((r) => r.correct)) : null;

  return (
    <div className="card overflow-hidden">
      {rows.length === 0 ? (
        <p className="text-white/40 text-xs px-4 py-4">
          No picks graded for this week yet — either nobody's picked, games haven't been synced, or none have finished.
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-white/5 text-left">
            <tr>
              <th className="px-4 py-2">Rank</th>
              <th className="px-4 py-2">Player</th>
              <th className="px-4 py-2">Correct</th>
              <th className="px-4 py-2">Incorrect</th>
              <th className="px-4 py-2">Win %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const isLeader = topScore !== null && row.correct === topScore && row.correct > 0;
              return (
                <tr key={row.userId} className={`border-t border-white/10 ${isLeader ? "bg-pigskin/10" : ""}`}>
                  <td className="px-4 py-2">{i + 1}</td>
                  <td className="px-4 py-2">
                    {isLeader && "🏆 "}
                    {row.username}
                  </td>
                  <td className="px-4 py-2">{row.correct}</td>
                  <td className="px-4 py-2">{row.incorrect}</td>
                  <td className="px-4 py-2">{row.winPct}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function GameCard({
  game,
  sport,
  onPick,
  onSetScore,
  onDelete,
}: {
  game: Game;
  sport: string;
  onPick: (gameId: string, team: "home" | "away") => void;
  onSetScore: (gameId: string, homeScore: number, awayScore: number) => void;
  onDelete: (gameId: string) => void;
}) {
  const locked = game.locked;
  const [homeInput, setHomeInput] = useState(game.homeScore?.toString() ?? "");
  const [awayInput, setAwayInput] = useState(game.awayScore?.toString() ?? "");

  return (
    <div className="card p-4 flex flex-col gap-3">
      <div className="flex justify-between text-xs text-white/50">
        <span>{new Date(game.startTime).toLocaleString()}</span>
        <span className="uppercase">{game.status.replace("_", " ")}</span>
      </div>
      {game.gameLabel && (
        <span className="self-start text-[10px] uppercase tracking-wide bg-pigskin/20 text-pigskin px-2 py-0.5 rounded">
          {game.gameLabel}
        </span>
      )}
      <div className="flex flex-col gap-2">
        <TeamRow
          abbr={game.awayTeamAbbr}
          fullName={game.awayTeam}
          logo={sport === "CFB" ? game.awayLogoThrowback || game.awayLogo : game.awayLogo}
          record={game.awayRecord}
          rank={game.awayRank}
          score={game.awayScore}
          selected={game.myPick === "away"}
          winner={game.winner === "away"}
          locked={locked}
          onClick={() => onPick(game.id, "away")}
        />
        <TeamRow
          abbr={game.homeTeamAbbr}
          fullName={game.homeTeam}
          logo={sport === "CFB" ? game.homeLogoThrowback || game.homeLogo : game.homeLogo}
          record={game.homeRecord}
          rank={game.homeRank}
          score={game.homeScore}
          selected={game.myPick === "home"}
          winner={game.winner === "home"}
          locked={locked}
          onClick={() => onPick(game.id, "home")}
        />
      </div>
      {game.isManual && (
        <div className="flex items-end gap-2 border-t border-white/10 pt-3 text-xs">
          <label className="flex flex-col gap-1">
            Away score
            <input
              type="number"
              step="0.1"
              className="bg-black/20 border border-white/15 rounded px-2 py-1 w-20"
              value={awayInput}
              onChange={(e) => setAwayInput(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1">
            Home score
            <input
              type="number"
              step="0.1"
              className="bg-black/20 border border-white/15 rounded px-2 py-1 w-20"
              value={homeInput}
              onChange={(e) => setHomeInput(e.target.value)}
            />
          </label>
          <button
            className="btn-primary text-xs py-1.5"
            onClick={() => {
              const h = parseFloat(homeInput);
              const a = parseFloat(awayInput);
              if (!isNaN(h) && !isNaN(a)) onSetScore(game.id, h, a);
            }}
          >
            Save score
          </button>
          <button className="ml-auto text-white/40 hover:text-red-400 transition-colors" onClick={() => onDelete(game.id)}>
            Remove
          </button>
        </div>
      )}
      {locked && game.picks.length > 0 && (
        <div className="text-xs text-white/50 border-t border-white/10 pt-2">
          {game.picks.map((p) => (
            <span key={p.username} className={`mr-3 ${p.isCorrect === true ? "text-green-400" : p.isCorrect === false ? "text-red-400" : ""}`}>
              {p.username}: {p.pickedTeam}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function TeamRow({
  abbr,
  fullName,
  logo,
  record,
  rank,
  score,
  selected,
  winner,
  locked,
  onClick,
}: {
  abbr: string;
  fullName: string;
  logo: string | null;
  record: string | null;
  rank: number | null;
  score: number | null;
  selected: boolean;
  winner: boolean;
  locked: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={locked}
      className={`flex items-center justify-between px-3 py-2 rounded-lg border transition-colors text-left
        ${selected ? "border-pigskin bg-pigskin/20" : "border-white/15 hover:border-white/30"}
        ${winner ? "font-semibold" : ""}
        disabled:cursor-not-allowed`}
    >
      <span className="flex items-center gap-2 min-w-0">
        {logo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt="" className="w-6 h-6 object-contain shrink-0" onError={(e) => (e.currentTarget.style.display = "none")} />
        )}
        {rank != null && <RankBadge rank={rank} abbr={abbr} />}
        <span className="truncate">
          {rank == null && <span className="text-white/50 mr-2">{abbr}</span>}
          {fullName}
        </span>
        {record && <span className="text-white/40 text-xs shrink-0">({record})</span>}
      </span>
      {score !== null && <span className="shrink-0 ml-2">{score}</span>}
    </button>
  );
}

// Styled after the classic CFB broadcast score bug: navy chip, orange rank
// number, team abbreviation beside it.
function RankBadge({ rank, abbr }: { rank: number; abbr: string }) {
  return (
    <span className="flex items-center gap-1 bg-[#0b1f3a] border border-white/20 rounded px-1.5 py-0.5 shrink-0">
      <span className="text-pigskin font-bold text-xs leading-none">{rank}</span>
      <span className="text-white/90 text-[10px] font-semibold leading-none">{abbr}</span>
    </span>
  );
}
