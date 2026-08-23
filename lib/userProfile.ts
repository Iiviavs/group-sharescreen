import { getSignalingHttpBase } from "./roomsApi";
import type { Account } from "./accountApi";

// Whoever this account is currently connected to, if it's a *public* room —
// the server (see GET /users/:id) deliberately never reveals a private one,
// same privacy line the room itself already draws for a stranger looking
// someone up.
export type LiveRoomStatus = { room: string; peopleCount: number } | null;

export type UserProfile = {
  account: Account;
  live: LiveRoomStatus;
};

// Public profile page data (see app/user/[id]/page.tsx) — reachable by
// clicking a name in the room header or the participant list, both of which
// carry the account id as PeerInfo.userId. No auth required: this is the
// same information a room's own peer list already shows to everyone in it,
// just gathered into one page. Returns null for an id that isn't a real
// account (a guest's id, or one that no longer exists).
export async function fetchUserProfile(id: string, signal?: AbortSignal): Promise<UserProfile | null> {
  const res = await fetch(`${getSignalingHttpBase()}/users/${encodeURIComponent(id)}`, { signal });
  if (!res.ok) return null;
  const data = (await res.json()) as UserProfile;
  return data;
}

// mm:ss for under an hour, h:mm:ss beyond that — matches the room's own
// formatTime convention (see PartnerRewardModal.tsx) but extended with
// hours, since a lifetime call/mic/share total realistically grows well
// past 59 minutes.
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${h}h ${String(m).padStart(2, "0")}min`;
  }
  if (m > 0) {
    return `${m}min ${String(s).padStart(2, "0")}s`;
  }
  return `${s}s`;
}
