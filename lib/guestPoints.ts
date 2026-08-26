"use client";

import { getStoredGuestToken } from "./guestToken";
import { getSignalingHttpBase } from "./roomsApi";

// A guest's points total, the counterpart of Account.points for someone who
// never made an account (see the API's guestPointsStore.ts). Read through
// AuthContext's `points`, which picks between this and the account's own —
// no component should need to know which kind of identity it's showing.
//
// The guest token is the whole identity here: these points are stored under
// what's inside it and nothing else, so a browser that gets a new token is a
// new person starting at zero. That is the intended behaviour, not a
// limitation to work around — see the API-side header for the full story.
export async function fetchGuestPoints(): Promise<number | null> {
  const token = getStoredGuestToken();
  // No guest identity yet: this browser has never registered a name, so
  // there is nobody to have points. Distinct from a failed request below,
  // which shouldn't be read as "zero points" either.
  if (!token) return null;
  try {
    const res = await fetch(`${getSignalingHttpBase()}/guest/points`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { points?: unknown };
    return typeof data.points === "number" ? data.points : null;
  } catch {
    // Offline, or an API too old to know this route — either way the honest
    // answer is "unknown", and the caller keeps whatever it already had.
    return null;
  }
}
