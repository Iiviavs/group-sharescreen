"use client";

import { useSyncExternalStore } from "react";
import { getSignalingHttpBase } from "./roomsApi";

export type Account = {
  id: string;
  username: string;
  displayName: string;
  flags: string[];
  createdAt: number;
  updatedAt: number;
};

const TOKEN_STORAGE_KEY = "sharescreen:accountToken";

// localStorage (not sessionStorage) — unlike the admin token in
// adminApi.ts, a regular account is meant to keep someone logged in across
// browser sessions, not just the current tab.
let cachedToken: string | null = null;
let initialized = false;
const listeners = new Set<() => void>();

function readStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function getAccountToken(): string | null {
  if (!initialized) {
    cachedToken = readStoredToken();
    initialized = true;
  }
  return cachedToken;
}

function setAccountToken(token: string | null) {
  cachedToken = token;
  initialized = true;
  if (typeof window !== "undefined") {
    try {
      if (token) window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
      else window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    } catch {
      // ignored - localStorage may be unavailable (private mode, quota, etc.)
    }
  }
  listeners.forEach((l) => l());
}

function subscribeAccountToken(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getAccountTokenServer(): string | null {
  return null;
}

export function useAccountToken(): string | null {
  return useSyncExternalStore(subscribeAccountToken, getAccountToken, getAccountTokenServer);
}

async function parseErrorMessage(res: Response, fallback: string): Promise<string> {
  const data = await res.json().catch(() => null);
  return (data && typeof data === "object" && "error" in data && String(data.error)) || fallback;
}

export async function registerAccount(
  username: string,
  displayName: string,
  password: string
): Promise<{ token: string; account: Account }> {
  const res = await fetch(`${getSignalingHttpBase()}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, displayName, password }),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res, "Falha ao criar conta."));
  const data = (await res.json()) as { token: string; account: Account };
  setAccountToken(data.token);
  return data;
}

export async function loginAccount(
  username: string,
  password: string
): Promise<{ token: string; account: Account }> {
  const res = await fetch(`${getSignalingHttpBase()}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res, "Usuário ou senha inválidos."));
  const data = (await res.json()) as { token: string; account: Account };
  setAccountToken(data.token);
  return data;
}

export function logoutAccount() {
  setAccountToken(null);
}

// Resolves the currently stored token to its account, clearing it if the
// server no longer accepts it (expired, or the account is gone) — called on
// startup to decide whether to auto-connect as this account.
export async function fetchMe(): Promise<Account | null> {
  const token = getAccountToken();
  if (!token) return null;
  const res = await fetch(`${getSignalingHttpBase()}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    setAccountToken(null);
    return null;
  }
  const data = (await res.json()) as { account: Account };
  return data.account;
}
