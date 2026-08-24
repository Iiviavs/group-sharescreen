"use client";

// Where the moderation panel keeps "where you were": which tab, what you had
// typed, which filters were on, and how far down the list you had scrolled.
//
// This exists so that opening a room in moderation mode and coming back lands
// on exactly that spot instead of a fresh dashboard — the viewer is a
// separate route, so the panel is fully unmounted while it's open and would
// otherwise rebuild itself from scratch.
//
// sessionStorage, matching the admin token's own storage (see adminApi.ts):
// this is moderator-session state, and it should die with the tab for the
// same reason the token does. Every access is wrapped — sessionStorage
// throws outright in some privacy modes, and losing the scroll position is
// never worth breaking the panel over.

const STORAGE_KEY = "sharescreen:adminView";

export type AdminViewState = {
  tab: string;
  search: string;
  filters: string[];
  scrollY: number;
};

export function readAdminViewState(): Partial<AdminViewState> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const value = parsed as Record<string, unknown>;
    return {
      tab: typeof value.tab === "string" ? value.tab : undefined,
      search: typeof value.search === "string" ? value.search : undefined,
      filters: Array.isArray(value.filters)
        ? value.filters.filter((f): f is string => typeof f === "string")
        : undefined,
      scrollY: typeof value.scrollY === "number" ? value.scrollY : undefined,
    };
  } catch {
    return {};
  }
}

// Merges rather than replaces: the tab lives in the admin page and the
// search/filters/scroll live in the moderation panel, so each writes only its
// own slice without having to know the rest.
export function patchAdminViewState(patch: Partial<AdminViewState>) {
  if (typeof window === "undefined") return;
  try {
    const next = { ...readAdminViewState(), ...patch };
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignored — see the module comment.
  }
}
