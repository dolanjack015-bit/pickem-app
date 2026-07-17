import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-col items-center text-center gap-6 py-16">
      <h1 className="font-display text-4xl md:text-5xl">Pick&rsquo;em, without the spreadsheet.</h1>
      <p className="text-white/70 max-w-xl">
        Create a league, invite your friends, pick winners for NFL and CFB matchups each week, and let the
        leaderboard tally itself &mdash; scores sync straight from live results.
      </p>
      <div className="flex gap-3">
        <Link href="/register" className="btn-primary">
          Start a league
        </Link>
        <Link href="/login" className="px-5 py-2.5 rounded-lg border border-white/20 hover:border-white/40 transition-colors">
          Sign in
        </Link>
      </div>
    </div>
  );
}
