"use client";

import { useSyncExternalStore } from "react";
import { getSignalingHttpBase } from "./roomsApi";
import type {
  Announcement,
  AnnouncementButtonAction,
  AnnouncementColor,
  AnnouncementSound,
  AnnouncementVisibility,
} from "./announcement";
import type { Partner } from "./partner";

export type { Announcement, AnnouncementButtonAction, AnnouncementColor, AnnouncementSound, AnnouncementVisibility };
export type { Partner };

const TOKEN_STORAGE_KEY = "sharescreen:adminToken";

// sessionStorage (not localStorage) on purpose — a moderator token
// shouldn't silently outlive the browser tab/session the same way a
// regular viewer's display name does.
//
// Cached in a module-level variable (rather than re-reading sessionStorage
// on every call) specifically so useAdminToken below has a stable snapshot
// to hand useSyncExternalStore, and so login/logout notify subscribers
// instead of components having to poll or re-render themselves in an effect.
let cachedToken: string | null = null;
let initialized = false;
const listeners = new Set<() => void>();

function readStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function getAdminToken(): string | null {
  if (!initialized) {
    cachedToken = readStoredToken();
    initialized = true;
  }
  return cachedToken;
}

function setAdminToken(token: string | null) {
  cachedToken = token;
  initialized = true;
  if (typeof window !== "undefined") {
    try {
      if (token) window.sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
      else window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    } catch {
      // ignored - sessionStorage may be unavailable (private mode, quota, etc.)
    }
  }
  listeners.forEach((l) => l());
}

function subscribeAdminToken(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getAdminTokenServer(): string | null {
  return null;
}

export function useAdminToken(): string | null {
  return useSyncExternalStore(subscribeAdminToken, getAdminToken, getAdminTokenServer);
}

// Admin is no longer a separate Basic-Auth credential — it's just a regular
// account (see accountApi.ts / server/accountStore.ts) whose flags include
// "ADMIN", so logging in here goes through the exact same /auth/login the
// rest of the app uses. The admin token is still kept in its own
// sessionStorage slot (not accountApi's localStorage one) so a moderator
// session doesn't silently outlive the tab the way a regular viewer's does.
export async function adminLogin(user: string, password: string): Promise<void> {
  const res = await fetch(`${getSignalingHttpBase()}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user, password }),
  });
  if (!res.ok) throw new Error("Usuário ou senha inválidos.");
  const data = (await res.json()) as { token: string; account: { flags: string[] } };
  if (!data.account.flags.includes("ADMIN")) {
    throw new Error("Essa conta não tem permissão de administrador.");
  }
  setAdminToken(data.token);
}

export function adminLogout() {
  // JWTs are stateless — there's nothing to revoke server-side, so logging
  // out is just dropping the locally stored token.
  setAdminToken(null);
}

export type AdminRoomPeer = {
  id: string;
  name: string | null;
  sharing: boolean;
  mic: boolean;
  ip: string;
};

export type AdminRoom = {
  handle: string;
  isPrivate: boolean;
  createdAt: number;
  peopleCount: number;
  peers: AdminRoomPeer[];
};

export async function fetchAdminRooms(signal?: AbortSignal): Promise<AdminRoom[]> {
  const token = getAdminToken();
  if (!token) throw new Error("unauthorized");
  const res = await fetch(`${getSignalingHttpBase()}/admin/rooms`, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });
  if (res.status === 401) {
    setAdminToken(null);
    throw new Error("unauthorized");
  }
  if (!res.ok) throw new Error(`Falha ao carregar salas (status ${res.status})`);
  const data = (await res.json()) as { rooms: AdminRoom[] };
  return data.rooms;
}

export type AnnouncementStats = {
  views: number;
  buttonClicks: number;
  xClicks: number;
};

export type AnnouncementState = {
  announcement: Announcement | null;
  stats: AnnouncementStats | null;
};

export async function fetchCurrentAnnouncement(signal?: AbortSignal): Promise<AnnouncementState> {
  const token = getAdminToken();
  if (!token) throw new Error("unauthorized");
  const res = await fetch(`${getSignalingHttpBase()}/admin/announcement`, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });
  if (res.status === 401) {
    setAdminToken(null);
    throw new Error("unauthorized");
  }
  if (!res.ok) throw new Error(`Falha ao carregar aviso (status ${res.status})`);
  return (await res.json()) as AnnouncementState;
}

export type SendAnnouncementInput = {
  // Optional custom id — server generates one when omitted. Ignored by
  // editAnnouncement below (an edit always keeps the active announcement's
  // existing id).
  id?: string;
  text: string;
  hasButton: boolean;
  // The four fields below are only validated/used server-side when
  // hasButton is true.
  buttonLabel: string;
  buttonAction: AnnouncementButtonAction;
  // Required unless buttonAction is "reload".
  buttonUrl?: string;
  color: AnnouncementColor;
  dismissible: boolean;
  visibility: AnnouncementVisibility;
  sound: AnnouncementSound;
  persistent: boolean;
};

async function postOrPutAnnouncement(
  method: "POST" | "PUT",
  input: SendAnnouncementInput | (Omit<SendAnnouncementInput, "id"> & { id: string })
): Promise<AnnouncementState> {
  const token = getAdminToken();
  if (!token) throw new Error("unauthorized");
  const res = await fetch(`${getSignalingHttpBase()}/admin/announcement`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
  if (res.status === 401) {
    setAdminToken(null);
    throw new Error("unauthorized");
  }
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(
      (data && typeof data === "object" && "error" in data && String(data.error)) ||
        `Falha ao salvar aviso (status ${res.status})`
    );
  }
  return (await res.json()) as AnnouncementState;
}

export async function sendAnnouncement(input: SendAnnouncementInput): Promise<AnnouncementState> {
  return postOrPutAnnouncement("POST", input);
}

// Edits the currently active announcement in place — same id, accumulated
// stats preserved, version bumped (see server/signaling.ts's PUT handler).
// `id` must match the currently active announcement's id (a stale/mismatched
// one is rejected with a 409, surfaced as a thrown error) so a second admin
// tab can't silently clobber an announcement someone else already replaced.
export async function editAnnouncement(
  id: string,
  input: Omit<SendAnnouncementInput, "id">
): Promise<AnnouncementState> {
  return postOrPutAnnouncement("PUT", { ...input, id });
}

export async function clearAnnouncement(): Promise<void> {
  const token = getAdminToken();
  if (!token) throw new Error("unauthorized");
  const res = await fetch(`${getSignalingHttpBase()}/admin/announcement`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    setAdminToken(null);
    throw new Error("unauthorized");
  }
  if (!res.ok) throw new Error(`Falha ao remover aviso (status ${res.status})`);
}

// Shared by every admin fetch below: attaches the bearer token, treats a 401
// as a signal to drop the stored token (mirrors fetchAdminRooms above), and
// throws with the server's own error message when one is provided.
async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAdminToken();
  if (!token) throw new Error("unauthorized");
  const res = await fetch(`${getSignalingHttpBase()}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    setAdminToken(null);
    throw new Error("unauthorized");
  }
  if (res.status === 204) return undefined as T;
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(
      (data && typeof data === "object" && "error" in data && String(data.error)) ||
        `Falha na requisição (status ${res.status})`
    );
  }
  return res.json() as Promise<T>;
}

export type AdminStats = {
  connectedSockets: number;
  peopleOnline: number;
  sharingCount: number;
  publicRooms: number;
  privateRooms: number;
  bannedIps: number;
  bannedWords: number;
  mongo: { enabled: boolean; connected: boolean };
};

export async function fetchAdminStats(): Promise<AdminStats> {
  return adminFetch<AdminStats>("/admin/stats");
}

export type IpBan = {
  ip: string;
  reason: string;
  createdAt: number;
  expiresAt: number | null;
};

export async function fetchBans(): Promise<IpBan[]> {
  const data = await adminFetch<{ bans: IpBan[] }>("/admin/bans");
  return data.bans;
}

export async function banIp(input: { ip: string; reason: string; durationMinutes?: number }): Promise<IpBan> {
  const data = await adminFetch<{ ban: IpBan }>("/admin/bans", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return data.ban;
}

export async function unbanIp(ip: string): Promise<void> {
  await adminFetch<void>(`/admin/bans/${encodeURIComponent(ip)}`, { method: "DELETE" });
}

export async function fetchBannedWords(): Promise<string[]> {
  const data = await adminFetch<{ words: string[] }>("/admin/banned-words");
  return data.words;
}

export async function setBannedWords(words: string[]): Promise<string[]> {
  const data = await adminFetch<{ words: string[] }>("/admin/banned-words", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ words }),
  });
  return data.words;
}

// Sidebar partner-ad slot (see components/PartnerCard.tsx). Unlike the
// announcement banner there can be more than one active at once — this is
// admin-only bookkeeping (weight/createdAt) on top of the public `Partner`
// shape everyone else gets.
export type AdminPartner = Partner & {
  weight: number;
  createdAt: number;
};

export type PartnerStats = { views: number; clicks: number };

export type PartnerAdminList = {
  partners: AdminPartner[];
  emptyPercent: number;
  stats: Record<string, PartnerStats>;
};

export type PartnerInput = {
  title: string;
  description: string;
  imageUrl?: string;
  buttonLabel: string;
  buttonUrl: string;
  backgroundColor?: string;
  textColor?: string;
  buttonBackgroundColor?: string;
  buttonTextColor?: string;
  weight: number;
  expiresAt: number | null;
};

export async function fetchAdminPartners(): Promise<PartnerAdminList> {
  return adminFetch<PartnerAdminList>("/admin/partners");
}

export async function createPartner(
  input: PartnerInput
): Promise<{ partner: AdminPartner; stats: PartnerStats }> {
  return adminFetch("/admin/partners", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function editPartner(
  id: string,
  input: PartnerInput
): Promise<{ partner: AdminPartner; stats: PartnerStats }> {
  return adminFetch(`/admin/partners/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function deletePartner(id: string): Promise<void> {
  await adminFetch<void>(`/admin/partners/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function setPartnerEmptyPercent(emptyPercent: number): Promise<number> {
  const data = await adminFetch<{ emptyPercent: number }>("/admin/partner-settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ emptyPercent }),
  });
  return data.emptyPercent;
}
