"use client";

// Cloudflare Turnstile — gates the WS "join" message (see
// signalingClient.ts's joinRoom/performJoin), matching what
// server/turnstile.ts requires on the API side. Opt-in via
// NEXT_PUBLIC_TURNSTILE_SITE_KEY: unset, and getTurnstileToken() resolves
// null immediately — the server no-ops the check the same way when its own
// TURNSTILE_SECRET_KEY isn't configured, so an unconfigured deployment
// (local dev, or before both sides are wired up) behaves exactly as before.
const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

type TurnstileRenderOptions = {
  sitekey: string;
  callback: (token: string) => void;
  "error-callback"?: () => void;
  "expired-callback"?: () => void;
  appearance?: "always" | "execute" | "interaction-only";
  execution?: "render" | "execute";
};

interface TurnstileApi {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => string;
  execute: (widgetId: string) => void;
  reset: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

// How long to wait for the challenges.cloudflare.com script (loaded via
// <Script> in app/layout.tsx, strategy="afterInteractive") to be ready
// before giving up on the very first call — a direct link straight into
// /watch/[handle] can trigger a join before that script has finished.
const SCRIPT_READY_TIMEOUT_MS = 8_000;
const EXECUTE_TIMEOUT_MS = 15_000;

let widgetId: string | null = null;
let containerEl: HTMLDivElement | null = null;
// Single outstanding request at a time is the expected case (joins are
// awaited sequentially by signalingClient) — if a second call ever does
// race ahead of the first, this just gets reassigned to the newer caller and
// the superseded one resolves null via its own timeout below rather than
// hanging forever.
let settleCurrent: ((token: string | null) => void) | null = null;

function waitForTurnstileScript(): Promise<TurnstileApi | null> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  return new Promise((resolve) => {
    const start = Date.now();
    const interval = setInterval(() => {
      if (window.turnstile) {
        clearInterval(interval);
        resolve(window.turnstile);
      } else if (Date.now() - start > SCRIPT_READY_TIMEOUT_MS) {
        clearInterval(interval);
        resolve(null);
      }
    }, 100);
  });
}

function ensureWidget(turnstile: TurnstileApi): string {
  if (widgetId) return widgetId;
  const container = document.createElement("div");
  // Fixed-positioned, not display:none — "interaction-only" keeps this at
  // 0x0 and invisible unless Cloudflare's risk assessment decides a real
  // interactive challenge is needed, and a genuinely hidden element can't be
  // shown to the user if that happens. Centered (rather than a corner) so a
  // challenge that does become visible reads as the deliberate verification
  // step it is, not a stray toast.
  container.style.position = "fixed";
  container.style.top = "50%";
  container.style.left = "50%";
  container.style.transform = "translate(-50%, -50%)";
  container.style.zIndex = "9999";
  document.body.appendChild(container);
  containerEl = container;
  widgetId = turnstile.render(container, {
    sitekey: SITE_KEY as string,
    appearance: "interaction-only",
    execution: "execute",
    // Solved — hide the box immediately rather than leaving Cloudflare's
    // success checkmark sitting on screen; getTurnstileToken un-hides it
    // before the next execute(), for whenever the next join needs it again.
    callback: (token) => {
      if (containerEl) containerEl.style.visibility = "hidden";
      settleCurrent?.(token);
    },
    "error-callback": () => settleCurrent?.(null),
    "expired-callback": () => settleCurrent?.(null),
  });
  return widgetId;
}

// Resolves a fresh, single-use Turnstile token, or null if: Turnstile isn't
// configured, the challenge script never loaded, or the challenge itself
// failed/expired/timed out. Callers send whatever comes back to the server
// as-is — server/turnstile.ts is what actually decides whether a null token
// is acceptable (it is, iff TURNSTILE_SECRET_KEY isn't configured either).
export async function getTurnstileToken(): Promise<string | null> {
  if (!SITE_KEY || typeof window === "undefined") return null;
  const turnstile = await waitForTurnstileScript();
  if (!turnstile) return null;
  const id = ensureWidget(turnstile);

  return new Promise((resolve) => {
    let settled = false;
    const settle = (token: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (settleCurrent === settle) settleCurrent = null;
      resolve(token);
    };
    const timeout = setTimeout(() => settle(null), EXECUTE_TIMEOUT_MS);
    settleCurrent = settle;
    // Visible again for this attempt — undoes the callback's hide-on-success
    // above, in case the previous attempt left it hidden.
    if (containerEl) containerEl.style.visibility = "visible";
    // A widget that already produced a token must be reset before it can
    // execute again — always reset first so this works whether or not a
    // previous getTurnstileToken() call ran before it.
    turnstile.reset(id);
    turnstile.execute(id);
  });
}
