// Shared between the admin panel (which builds/sends one) and the live
// site-wide banner (which renders whatever the server currently has active)
// so both sides agree on the shape and the color→CSS mapping never drifts
// between the admin's preview and what real visitors actually see.

export type AnnouncementColor = "green" | "red" | "blue";
export type AnnouncementButtonAction = "open-new-tab" | "open-same-tab" | "reload";

export type Announcement = {
  id: string;
  text: string;
  buttonLabel: string;
  buttonAction: AnnouncementButtonAction;
  // Only meaningful for open-new-tab/open-same-tab — null for "reload".
  buttonUrl: string | null;
  color: AnnouncementColor;
  dismissible: boolean;
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
