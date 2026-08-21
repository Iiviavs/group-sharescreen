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

// Exported because the social login gets its token from a redirect rather
// than from a fetch in this module (see oauthApi.ts / the OAuth callback
// page) — it still has to land in the same place, through the same
// listeners, so every consumer of useAccountToken reacts identically no
// matter how the token was obtained.
export function setAccountToken(token: string | null) {
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

// Finishes a social *signup*: the ticket proves the provider identity was
// already verified server-side, and these are the names the user just chose
// for it. Same { token, account } contract as loginAccount above, so the
// caller can't tell the two apart afterwards.
export async function completeOAuthSignup(
  ticket: string,
  username: string,
  displayName: string
): Promise<{ token: string; account: Account }> {
  const res = await fetch(`${getSignalingHttpBase()}/auth/oauth/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticket, username, displayName }),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res, "Falha ao criar conta."));
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
