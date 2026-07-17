"use client";

import Link from "next/link";
import { useSession, signOut } from "next-auth/react";

export default function NavBar() {
  const { data: session } = useSession();

  return (
    <header className="border-b border-white/10">
      <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
        <Link href="/" className="font-display text-xl tracking-wide text-chalk">
          🏈 Pick&rsquo;em League
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          {session?.user ? (
            <>
              <Link href="/leagues" className="hover:text-pigskin transition-colors">
                My Leagues
              </Link>
              <span className="text-white/50">{session.user.name}</span>
              <button onClick={() => signOut({ callbackUrl: "/" })} className="hover:text-pigskin transition-colors">
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className="hover:text-pigskin transition-colors">
                Sign in
              </Link>
              <Link href="/register" className="btn-primary text-sm">
                Sign up
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
