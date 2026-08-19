"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  type Account,
  useAccountToken,
  getAccountToken,
  fetchMe,
  loginAccount,
  registerAccount,
  logoutAccount,
} from "./accountApi";
import { signalingClient, getStoredName } from "./signalingClient";

type AuthContextValue = {
  // The logged-in account, or null once resolved to "no account" (guest, no
  // token, or an expired/invalid token).
  account: Account | null;
  // True while the stored token (if any) is still being resolved against
  // /auth/me — the one request this context makes on app open.
  loading: boolean;
  login: (username: string, password: string) => Promise<Account>;
  register: (username: string, displayName: string, password: string) => Promise<Account>;
  logout: () => void;
  // Re-resolves the current token against /auth/me — e.g. after an action
  // that changes the account server-side (rename, flags) outside this tab.
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const accountToken = useAccountToken();
  const [account, setAccount] = useState<Account | null>(null);
  // Tracks which token the effect below has already resolved (via
  // accountApi.fetchMe) — while it's behind the current accountToken, we
  // don't yet know whether there's an account behind it, hence `loading`.
  const [resolvedToken, setResolvedToken] = useState<string | null>(null);

  // Skips the fetch entirely once resolvedToken already matches (e.g. right
  // after login()/register() below set both in the same tick) — the actual
  // "no token" / "not yet resolved" cases are handled by the `account`
  // derivation beneath, not by clearing state here.
  useEffect(() => {
    if (!accountToken || resolvedToken === accountToken) return;
    let cancelled = false;
    fetchMe()
      .then((acc) => {
        if (cancelled) return;
        setAccount(acc);
        setResolvedToken(accountToken);
      })
      .catch(() => {
        if (!cancelled) setResolvedToken(accountToken);
      });
    return () => {
      cancelled = true;
    };
  }, [accountToken, resolvedToken]);

  const refresh = useCallback(async () => {
    const acc = await fetchMe();
    setAccount(acc);
    setResolvedToken(getAccountToken());
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const { account: acc } = await loginAccount(username, password);
    setAccount(acc);
    setResolvedToken(getAccountToken());
    return acc;
  }, []);

  const register = useCallback(
    async (username: string, displayName: string, password: string) => {
      const { account: acc } = await registerAccount(username, displayName, password);
      setAccount(acc);
      setResolvedToken(getAccountToken());
      return acc;
    },
    []
  );

  // Turns a stored (or freshly obtained, via login()/register() above)
  // account token into an actual signaling registration — lives here rather
  // than in any one page so it also fires on a direct link straight into a
  // room, or a reload of one, not just when the home page happens to mount
  // first (it used to live only there, which left a logged-in account stuck
  // on "Reconectando..." forever on any other route: signalingClient's own
  // constructor deliberately skips auto-registering when an account token
  // is present, expecting something else to resolve it — see its comment).
  // Also reset on logout so a later login re-registers instead of being
  // skipped as "already done" for a token that's no longer current.
  const registeredForTokenRef = useRef<string | null>(null);

  const logout = useCallback(() => {
    logoutAccount();
    setAccount(null);
    setResolvedToken(null);
    registeredForTokenRef.current = null;
    signalingClient.logoutIdentity();
  }, []);

  // Only trust `account` once it was resolved for the token currently on
  // disk — otherwise it's either empty or leftover from a prior token.
  const resolvedAccount = accountToken && resolvedToken === accountToken ? account : null;
  const loading = Boolean(accountToken) && resolvedToken !== accountToken;

  // Falls back to any stored guest name if the token turned out to be
  // invalid/expired, mirroring what signalingClient's own constructor does
  // when there's no token at all. Guarded by the ref above (not just the
  // effect deps) so a later account refresh doesn't re-trigger a register()
  // call for a token already connected with.
  useEffect(() => {
    if (!accountToken || loading) return;
    if (registeredForTokenRef.current === accountToken) return;
    registeredForTokenRef.current = accountToken;
    if (resolvedAccount) {
      signalingClient.register(resolvedAccount.displayName, accountToken);
    } else {
      const storedName = getStoredName();
      if (storedName) signalingClient.register(storedName);
    }
  }, [accountToken, loading, resolvedAccount]);

  const value = useMemo<AuthContextValue>(
    () => ({ account: resolvedAccount, loading, login, register, logout, refresh }),
    [resolvedAccount, loading, login, register, logout, refresh]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// The logged-in account (or null) plus auth actions — read from anywhere
// under <AuthProvider> instead of calling accountApi directly, so the
// /auth/me lookup only ever happens once per app load.
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
