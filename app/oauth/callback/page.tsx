"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { setAccountToken } from "@/lib/accountApi";
import {
  oauthErrorMessage,
  parseOAuthFragment,
  type OAuthMessage,
  type OAuthResult,
} from "@/lib/oauthApi";
import { CompleteOAuthSignupForm } from "@/components/CompleteOAuthSignupForm";

// Where the API sends the browser back at the end of the OAuth dance, with
// the outcome in the URL fragment (see the API's server/oauthRoutes.ts).
//
// Two ways to get here, and this page handles both:
//
//   popup    — the normal case (oauthApi.startOAuthLogin). The result is
//              posted to the opener, which owns the UI, and this window
//              closes. Nothing is rendered for more than a blink.
//   redirect — the fallback when the popup was blocked. There's no opener,
//              so this page finishes the job itself: stores the token, or
//              shows the username step, then returns to where the user was.
export default function OAuthCallbackPage() {
  const router = useRouter();
  const [result, setResult] = useState<OAuthResult | null>(null);
  // Only ever true in redirect mode — in popup mode this window is gone
  // before anything is painted.
  const [handledInline, setHandledInline] = useState(false);

  useEffect(() => {
    const parsed = parseOAuthFragment(window.location.hash);
    // Strips the token/ticket out of the address bar (and out of the
    // history entry) as soon as it's been read.
    window.history.replaceState(null, "", window.location.pathname);

    const outcome: OAuthResult = parsed ?? {
      kind: "error",
      error: "unknown",
      next: "/",
    };

    const opener = window.opener as Window | null;
    if (opener && !opener.closed) {
      const message: OAuthMessage = { source: "golive-oauth", result: outcome };
      // Targeted at this exact origin, never "*": the payload can be a
      // session token, and the opener is same-origin by construction.
      opener.postMessage(message, window.location.origin);
      window.close();
      return;
    }

    // The rule's usual advice (derive it during render) can't apply here:
    // the result lives in window.location.hash, which doesn't exist during
    // the server render, so reading it in a state initializer would either
    // throw or hydrate into a mismatch. Reading it after mount and setting
    // state once is the only correct order — and it happens exactly once,
    // so there's no cascade to speak of.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setResult(outcome);
    setHandledInline(true);
    if (outcome.kind === "token") {
      setAccountToken(outcome.token);
      // AuthContext picks the new token up on its own (it subscribes to the
      // same store), so this only has to get the user back where they were.
      router.replace(outcome.next);
    }
  }, [router]);

  if (!handledInline || !result) {
    return (
      <main className="flex flex-1 items-center justify-center px-4 py-16">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Concluindo login...</p>
      </main>
    );
  }

  if (result.kind === "ticket") {
    return (
      <main className="flex flex-1 items-center justify-center px-4 py-16">
        <div className="w-full max-w-md rounded-2xl border border-black/10 bg-white p-8 shadow-sm dark:border-white/10 dark:bg-zinc-950">
          <CompleteOAuthSignupForm
            ticket={result.ticket}
            provider={result.provider}
            suggestedUsername={result.suggestedUsername}
            suggestedDisplayName={result.suggestedDisplayName}
            onSuccess={() => router.replace(result.next)}
            onCancel={() => router.replace(result.next)}
          />
        </div>
      </main>
    );
  }

  if (result.kind === "error") {
    return (
      <main className="flex flex-1 items-center justify-center px-4 py-16">
        <div className="w-full max-w-md rounded-2xl border border-black/10 bg-white p-8 text-center shadow-sm dark:border-white/10 dark:bg-zinc-950">
          <p className="text-sm text-red-500">{oauthErrorMessage(result.error)}</p>
          <button
            type="button"
            onClick={() => router.replace(result.next)}
            className="mt-4 rounded-lg bg-zinc-950 px-4 py-2.5 font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            Voltar
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">Entrando...</p>
    </main>
  );
}
