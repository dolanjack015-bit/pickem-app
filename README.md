# Pick'em League

A deployable web app for group NFL / CFB pick'em leagues. Create a league,
invite friends with a code, pick winners each week, and let scores sync in
automatically from ESPN's live scoreboard.

## Stack
- **Next.js 14** (App Router) — frontend + API routes in one app
- **Prisma + PostgreSQL** — data (free tier works fine via [Neon](https://neon.tech))
- **NextAuth (credentials)** — email/password auth
- **ESPN's public scoreboard API** — free, no key required, for live scores

## If ESPN returns the wrong season
Occasionally ESPN's `week`/`year`/`seasontype` scoreboard lookup silently
falls back to the most recently *completed* season instead of erroring —
this can happen even when a future season's schedule is already public,
if ESPN hasn't activated that season's internal week-indexing yet. The
app now detects this (games come back for the wrong calendar year) and
fails with a clear error instead of quietly importing the wrong season's
games.

When that happens, use **"Sync by exact date instead"** (a toggle below
the sync buttons on a league's page) — it pulls games by literal calendar
date instead of week number, which works regardless of whether ESPN has
"activated" that season yet. Figure out the date range for the week
you're after (e.g. via espn.com or the official league schedule) and enter
it there; the games still get filed under the Season/Week number shown in
the picker above.

## How picks lock and get scored
- **Locking is week-wide, not per-game.** For NFL and CFB, every pick in a
  week locks at once, at the kickoff of that week's *earliest* game —
  normally Thursday Night Football (or CFB's Thursday/Friday game, if the
  league has one that week). This is computed automatically from whatever
  games got synced (`Week.picksLockAt` = the earliest `startTime` among
  that week's games) and recalculated on every sync. You can't pick game
  4 on Sunday after already seeing how Thursday's game went.
- **Fantasy is the exception** — since matchups are entered by hand and
  don't share a common "week," each fantasy matchup locks individually at
  whatever time you set when you added it.
- **Grading is real-time.** Whenever a sync runs (manual button click or
  the cron job) and a game comes back `final` from ESPN, every pick tied
  to it is graded immediately and the leaderboard updates right then —
  it doesn't wait for a scheduled "grading day." Run the cron frequently
  (e.g. every 5–15 minutes) during game windows if you want scores to
  update live as games finish; run it less often otherwise.
- **Fantasy scores** are graded the same way the moment you type in a
  final score and hit **Save score** on that matchup.

## Pick archive
Every pick anyone's ever made stays in the database (nothing gets deleted
after grading), so a league page has a **Pick Archive** panel — collapsed
by default, click to expand — showing a full history: week, matchup, what
was picked, and whether it was right, newest first. Filter by sport, and
switch the "Player" dropdown to look at a teammate's history too (their
future/not-yet-started picks stay hidden, same privacy rule as the main
matchups view — you only see picks on games that have already kicked off).

## League management
- **Leave a league**: any member can remove themselves from the Members
  list on a league's page.
- **Remove a member**: the league owner can remove anyone else from that
  same list.
- **Delete a league**: only the owner, via the **Delete league** button —
  this permanently removes the league, every week/game synced under it,
  and every pick made in it. The owner can't be removed via "remove
  member" (to avoid an ownerless league); deleting the league is the only
  way to fully shut one down.

## Game coverage
- **NFL** — every regular-season week (1–18) plus every postseason week
  (wild card through the Super Bowl). Use **Sync full season** on a league's
  page to pull the whole thing in one go, or sync week-by-week.
- **CFB** — Week 0 is synced by calendar date (every game on August 29 of
  that season by default — adjustable in `lib/sync.ts` if the actual
  Week 0 slate falls elsewhere some year) rather than ESPN's own week
  numbering for that slate, which is inconsistent. **Postseason is synced
  as distinct rounds, the same mental model as NFL playoffs** — conference
  championships, regular (non-playoff) bowls, and each round of the CFB
  Playoff (First Round, Quarterfinal, Semifinal, National Championship)
  each land in their own separate week in the system, rather than being
  lumped together. This works by scanning ESPN's postseason games and
  categorizing each one from its game notes (e.g. "Quarterfinal", "SEC
  Championship") rather than trusting ESPN's own week-number grouping for
  that stretch, which mixes rounds and bowls together. Regular-season
  weeks are filtered down to games where at least one team is in the
  **AP Top 25** that week (refetched on every sync, so it stays current —
  note the poll doesn't exist yet during the off-season, so rankings will
  look empty/wrong until the preseason poll drops in August), plus the
  Army-Navy game, which gets its own "Army-Navy" label and is always
  included regardless of ranking.

## Logos, rankings, and records
- Team logos come from ESPN's scoreboard feed and are shown next to each
  team on the picks screen.
- For CFB, the UI prefers a team's "throwback" logo variant if ESPN has
  one tagged for that team, falling back to their normal logo otherwise —
  ESPN doesn't consistently tag a throwback alternate for every program, so
  coverage will vary team to team.
- Ranked CFB teams get a navy/orange rank chip next to their name, styled
  after the classic broadcast score-bug look.
- Records (e.g. "8-2") are pulled and shown next to each team, and refresh
  on every sync.

## How scoring works
1. Someone syncs a week (button in the UI, or an automatic cron job) —
   this pulls that week's games from ESPN and saves them.
2. League members pick a winner for each game before it starts. Picks lock
   automatically once a game's kickoff time passes.
3. When a synced game is marked `final`, every pick tied to it is graded
   (`isCorrect: true/false`) and the leaderboard updates.
4. Other members' picks for a game stay hidden until that game has started
   — so nobody can just copy the group.

## Local setup
```bash
npm install
cp .env.example .env      # fill in DATABASE_URL, NEXTAUTH_SECRET, CRON_SECRET
npx prisma migrate dev --name init
npm run dev
```
Open http://localhost:3000, sign up, create a league, and click **Sync live
scores** on a week with real games (pick a `season`/`week` that's currently
in progress to see live data — e.g. NFL week numbers run 1–18 within a
season starting around September).

## Deploying (Vercel + Neon, free tier)
1. Push this project to a GitHub repo.
2. Create a free Postgres database at [neon.tech](https://neon.tech) and
   copy its connection string into `DATABASE_URL`.
3. Import the repo into [Vercel](https://vercel.com/new).
4. Add environment variables in Vercel's project settings: `DATABASE_URL`,
   `NEXTAUTH_SECRET` (generate with `openssl rand -base64 32`),
   `NEXTAUTH_URL` (your deployed URL), and `CRON_SECRET` (any random string).
5. After the first deploy, run migrations against the production database
   once: `npx prisma migrate deploy` (with `DATABASE_URL` pointed at Neon).
6. Update the `secret=` query param in `vercel.json` to match your
   `CRON_SECRET`, commit, and redeploy — this lets Vercel Cron auto-refresh
   scores on a schedule so nobody has to click "Sync" manually.
   - Note: Vercel's free (Hobby) plan currently limits cron jobs to roughly
     once a day; the "every 5 minutes" schedule in `vercel.json` requires a
     paid plan. On the free plan, either sync manually via the UI button on
     game days, or point the cron at a free external scheduler (e.g.
     cron-job.org) hitting `https://your-app/api/cron/sync?secret=...`.

## Fantasy football (manual entry)
Fantasy leagues aren't a single standardized data source the way NFL/CFB
are, so fantasy matchups are entered by hand instead of synced:
1. On a league's page, switch the **Sport** dropdown to "Fantasy Football".
2. Use the **Add matchup** form to add each week's head-to-head pairing
   (just team/manager names — e.g. "Priya's Powerhouse" vs. "Jordan's
   Juggernauts") and set when picks should lock.
3. Everyone picks a winner like any other game.
4. Once real fantasy scores are in, punch the final score into that game's
   card and hit **Save score** — picks grade immediately and the
   leaderboard updates, same as an ESPN-synced game.

This works for any fantasy platform (Yahoo, ESPN, Sleeper, a league
commissioner's spreadsheet) since it's just "who won," entered by whoever's
tracking it. See the Yahoo section below if you'd rather pull scores
automatically instead of typing them in.

## Yahoo Fantasy integration (not yet built)
Feasible, but meaningfully more work than the ESPN scoreboard integration,
because Yahoo's Fantasy Sports API requires **OAuth2 login per user** —
there's no open/keyless endpoint like ESPN's or Sleeper's. Roughly:
1. You (the app owner) register an app at
   [developer.yahoo.com](https://developer.yahoo.com/apps/) to get a
   Client ID/Secret.
2. Add an OAuth flow: a `/api/auth/yahoo` redirect + callback route, store
   each user's access/refresh token (new `YahooToken` model), and refresh
   tokens as they expire.
3. Add a `lib/yahoo.ts` client that calls
   `fantasysports.yahooapis.com/fantasy/v2/...` with `format=json` (it
   returns XML by default) to pull a user's leagues and weekly matchups.
4. Add a `"FANTASY"` sport type alongside NFL/CFB so matchups (team vs.
   team, not real players) plug into the same Week/Game/Pick tables.

Say the word and I'll build this out as a follow-up — it's a self-contained
addition on top of what's here.

## Extending it
- **Confidence-point picks** (weight picks 1–16 instead of straight-up):
  add a `confidencePoints` field to `Pick` and sum weighted points instead
  of counting correct picks in the leaderboard route.
- **Against-the-spread picks**: ESPN's scoreboard response includes odds
  under `competitions[0].odds` — extend `lib/espn.ts` to pull the spread
  and store it on `Game`, then compare final margin to the spread when
  grading.
- **Fantasy via Sleeper instead of Yahoo**: if your group actually plays on
  Sleeper rather than Yahoo, that's the easier integration — Sleeper's API
  is free and keyless. Same idea as the Yahoo section above, minus the
  OAuth step.
- **Reminders**: hook a Slack/Discord webhook into the cron route to post
  "picks lock in 1 hour" messages.
