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

  async function joinLeague(e:
