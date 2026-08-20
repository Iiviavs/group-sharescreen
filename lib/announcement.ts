// Shared between the admin panel (which builds/sends one) and the live
// site-wide banner (which renders whatever the server currently has active)
// so both sides agree on the shape and the color→CSS mapping never drifts
// between the admin's preview and what real visitors actually see.

export type AnnouncementColor = "green" | "red" | "blue";
export type AnnouncementButtonAction = "open-new-tab" | "open-same-tab" | "reload";
// Mirrors server/signaling.ts's AnnouncementVisibility: "online-only" only
// ever reaches whoever was connected the moment it was sent/edited; "all"
// also reaches every connection opened later, for as long as it stays active.
export type AnnouncementVisibility = "online-only" | "all";
// Mirrors server/signaling.ts's AnnouncementSound.
export type AnnouncementSound = "always" | "live-only" | "off";

export type Announcement = {
  id: string;
  // Bumped by the server on every edit — see server/signaling.ts's
  // Announcement.version doc comment.
  version: number;
  text: string;
  // When false, no button is rendered at all (see AnnouncementBar.tsx) —
  // buttonLabel/buttonAction/buttonUrl are meaningless placeholders then.
  hasButton: boolean;
  buttonLabel: string;
  buttonAction: AnnouncementButtonAction;
  // Only meaningful for open-new-tab/open-same-tab — null for "reload".
  buttonUrl: string | null;
  color: AnnouncementColor;
  dismissible: boolean;
  visibility: AnnouncementVisibility;
  sound: AnnouncementSound;
  // When true, this banner only ever stops appearing via an explicit "x"
  // click or the admin removing it — it's never auto-hidden after a single
  // view (see the buttonAction === "reload" special case in
  // AnnouncementBanner.tsx) and, for "online-only" visibility specifically,
  // it survives a reload of a browser that already received it live (see
  // getStoredPersistentAnnouncement below) even though the server itself
  // never resends an "online-only" announcement to a new connection.
  persistent: boolean;
};

export const ANNOUNCEMENT_COLOR_PRESETS: Record<
  AnnouncementColor,
  { bg: string; text: string; label: string }
> = {
  green: { bg: "#065f46", text: "#ffffff", label: "Verde" },
  red: { bg: "#7f1d1d", text: "#ffffff", label: "Vermelho" },
  blue: { bg: "#1e3a8a", text: "#ffffff", label: "Azul" },
};

// Announcement ids the person has already dealt with — either they clicked
// the "x" on a dismissible one, or it was a "reload"-action one that already
// got shown once (see hideAnnouncementId's caller in AnnouncementBanner).
// Persisted (not just component state) since the whole point is that it
// survives a reload/reconnect instead of resetting every mount.
const HIDDEN_IDS_STORAGE_KEY = "sharescreen:hiddenAnnouncementIds";
// Caps how many past announcement ids a browser remembers — this is a log
// of everything ever dismissed/shown-once, not the live set, so it would
// otherwise grow forever over a long-lived browser profile.
const MAX_HIDDEN_IDS = 30;

export function getHiddenAnnouncementIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(HIDDEN_IDS_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? (parsed as string[]) : []);
  } catch {
    return new Set();
  }
}

export function hideAnnouncementId(id: string) {
  if (typeof window === "undefined") return;
  try {
    const ids = [...getHiddenAnnouncementIds()];
    if (ids.includes(id)) return;
    ids.push(id);
    const trimmed = ids.length > MAX_HIDDEN_IDS ? ids.slice(ids.length - MAX_HIDDEN_IDS) : ids;
    window.localStorage.setItem(HIDDEN_IDS_STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // ignored - localStorage may be unavailable (private mode, quota, etc.)
  }
}

// The last `persistent: true` announcement this browser actually received
// over the socket — the only way a "visibility: online-only" + persistent
// announcement can survive *this same browser* reloading, since the server
// deliberately never resends an online-only announcement to a new
// connection (see server/signaling.ts's "/ws" handler). AnnouncementBanner.tsx
// falls back to this whenever the live signaling state hasn't (yet, or
// ever, for online-only) told it otherwise, and keeps it in sync with every
// real "announcement" message: overwritten on every persistent one, cleared
// on every non-persistent one or explicit clear. A "visibility: all"
// announcement doesn't strictly need this (the server resends it to every
// new connection anyway) but goes through the same cache for one consistent
// code path, and it means one fewer round trip before it (re)appears.
const PERSISTENT_ANNOUNCEMENT_STORAGE_KEY = "sharescreen:persistentAnnouncement";

export function getStoredPersistentAnnouncement(): Announcement | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PERSISTENT_ANNOUNCEMENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Announcement) : null;
  } catch {
    return null;
  }
}

export function storePersistentAnnouncement(announcement: Announcement) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PERSISTENT_ANNOUNCEMENT_STORAGE_KEY, JSON.stringify(announcement));
  } catch {
    // ignored - localStorage may be unavailable (private mode, quota, etc.)
  }
}

export function clearStoredPersistentAnnouncement() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(PERSISTENT_ANNOUNCEMENT_STORAGE_KEY);
  } catch {
    // ignored - localStorage may be unavailable (private mode, quota, etc.)
  }
}
