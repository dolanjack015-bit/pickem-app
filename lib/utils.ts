export function generateInviteCode(length = 6): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  let code = "";
  for (let i = 0; i < length; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

/** Grade a single pick against a finalized game's winner. Ties never happen
 * in NFL/CFB under normal rules but are handled defensively. */
export function gradePick(pickedTeam: "home" | "away", winner: "home" | "away" | "tie" | null): boolean | null {
  if (!winner) return null;
  if (winner === "tie") return false;
  return pickedTeam === winner;
}
