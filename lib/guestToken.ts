"use client";

import { useSyncExternalStore } from "react";

// The guest identity token handed back by "registered" (see the API's
// server/signaling.ts) the first time a connection shows up without one.
//
// Lives in its own module rather than inside signalingClient.ts, which mints
// and stores it, because it is no longer only a signaling concern: it is
// also what names a guest's points server-side (see lib/guestPoints.ts and
// the API's guestPointsStore.ts), and pulling the whole signaling client
// into those callers just to read one localStorage key would be backwards.
//
// null once logged into an account (accountApi's own token takes over) or
// before this browser has ever registered as a guest at all.

// Deliberately localStorage, not sessionStorage: unlike the per-tab clientId
// in signalingClient.ts, this is meant to follow the guest around everywhere
// (every tab, every reload) since it's what proves "this is still the same
// guest" without ever being exposed to anyone else.
const GUEST_TOKEN_STORAGE_KEY = "sharescreen:guestToken";

// Changing this token *is* how a guest's points reset — they're keyed by the
// identity inside it and nothing else (see the API's guestPointsStore.ts for
// the full reasoning). So anything that writes here is changing whose points
// this browser is collecting, not just which name it reconnects under.
const listeners = new Set<() => void>();

export function getStoredGuestToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(GUEST_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredGuestToken(token: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(GUEST_TOKEN_STORAGE_KEY, token);
  } catch {
    // ignored - localStorage may be unavailable (private mode, quota, etc.)
  }
  // Fired even when the write above threw: a caller subscribed to "which
  // guest am I now" still needs to react to the identity change, and a
  // browser that can't persist it is exactly the case where re-reading is
  // the only way anything downstream finds out.
  for (const listener of listeners) listener();
}

/** Notifies when this browser's guest identity changes. Returns an unsubscribe. */
export function subscribeGuestToken(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Subscribes a component to this browser's guest identity. */
export function useGuestToken(): string | null {
  return useSyncExternalStore(subscribeGuestToken, getStoredGuestToken, () => null);
}
