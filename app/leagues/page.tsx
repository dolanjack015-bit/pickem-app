"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type League = { id: string; name: string; sport: string; inviteCode: string; role: string };

export default function LeaguesPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [leagues, setLeagues] = useState<League[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [newSport, setNewSport] = useState("NFL");
  const [joinCode, setJoinCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status, router]);

  async function loadLeagues() {
    setLoading(true);
    const res = await fetch("/api/leagues");
    if (res.ok) setLeagues(await res.json());
    setLoading(false);
  }

  useEffect(() => {
    if (status === "authenticated") loadLeagues();
  }, [status]);

  async function createLeague(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const res = await fetch("/api/leagues", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName, sport: newSport }),
    });
    if (res.ok) {
      setNewName("");
      await loadLeagues();
    } else {
      const data = await res.json();
      setMessage(data.error);
    }
  }

  async function joinLeague(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const res = await fetch("/api/leagues/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inviteCode: joinCode }),
    });
    if (res.ok) {
      setJoinCode("");
      await loadLeagues();
    } else {
      const data = await res.json();
      setMessage(data.error);
    }
  }

  if (status !== "authenticated") return null;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-3xl mb-4">My Leagues</h1>
        {loading ? (
          <p className="text-white/60">Loading...</p>
        ) : leagues.length === 0 ? (
          <p className="text-white/60">You&rsquo;re not in a league yet &mdash; create or join one below.</p>
        ) : (
          <div className="grid sm:grid-cols-2 gap-4">
            {leagues.map((l) => (
              <Link href={`/leagues/${l.id}`} key={l.id} className="card p-4 block hover:border-pigskin transition-colors">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold">{l.name}</h2>
                  <span className="text-xs uppercase text-pigskin">{l.sport}</span>
                </div>
                <p className="text-white/50 text-sm mt-1">Invite code: {l.inviteCode}</p>
              </Link>
            ))}
          </div>
        )}
      </div>

      {message && <p className="text-red-400 text-sm">{message}</p>}

      <div className="grid sm:grid-cols-2 gap-6">
        <form onSubmit={createLeague} className="card p-4 flex flex-col gap-3">
          <h3 className="font-semibold">Create a league</h3>
          <input
            className="bg-black/20 border border-white/15 rounded-lg px-3 py-2"
            placeholder="League name"
            required
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <select
            className="bg-black/20 border border-white/15 rounded-lg px-3 py-2"
            value={newSport}
            onChange={(e) => setNewSport(e.target.value)}
          >
            <option value="NFL">NFL</option>
            <option value="CFB">College Football</option>
            <option value="BOTH">Both</option>
          </select>
          <button className="btn-primary">Create league</button>
        </form>

        <form onSubmit={joinLeague} className="card p-4 flex flex-col gap-3">
          <h3 className="font-semibold">Join a league</h3>
          <input
            className="bg-black/20 border border-white/15 rounded-lg px-3 py-2 uppercase"
            placeholder="Invite code"
            required
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
          />
          <button className="btn-primary">Join league</button>
        </form>
      </div>
    </div>
  );
}
