"use client";

import { useSyncExternalStore } from "react";
import { getSignalingHttpBase } from "./roomsApi";

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

export async function adminLogin(user: string, password: string): Promise<void> {
  const res = await fetch(`${getSignalingHttpBase()}/admin/login`, {
    method: "POST",
    headers: { Authorization: `Basic ${btoa(`${user}:${password}`)}` },
  });
  if (!res.ok) throw new Error("Usuário ou senha inválidos.");
  const data = (await res.json()) as { token: string };
  setAdminToken(data.token);
}

export function adminLogout() {
  const token = getAdminToken();
  setAdminToken(null);
  if (!token) return;
  fetch(`${getSignalingHttpBase()}/admin/logout`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => {
    // ignored - logging out is best-effort; clearing the local token above
    // already prevents this tab from using it again either way.
  });
}

export type AdminRoomPeer = { id: string; name: string | null; sharing: boolean; mic: boolean };

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
