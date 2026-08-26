"use client";

import { useEffect, useState } from "react";
import { MdOutlineDesktopWindows } from "react-icons/md";
import { isDesktopApp } from "@/lib/desktop";
import { detectDownloadPlatform } from "@/lib/downloadTargets";
import {
  getStoredOpenInAppDismissed,
  getStoredOpenRoomsInApp,
  setStoredOpenInAppDismissed,
  setStoredOpenRoomsInApp,
} from "@/lib/mediaPreferences";
import { DownloadAppButton } from "./DownloadAppButton";

// Offers to hand this room over to the desktop app, and — once someone says
// yes — stops asking and just does it.
//
// Worth being clear about what is and is not possible here, because the
// obvious wish is "detect the app and redirect automatically". A website
// cannot detect whether a desktop app is installed; browsers deliberately
// removed every API that leaked it, because it is a fingerprinting vector.
// What a page *can* do is navigate to a custom scheme and let the OS decide
// whether anything answers — and if nothing does, the user gets an error
// dialog with no way for us to know it happened.
//
// So the flow is the one Discord, Slack and Zoom all converged on: ask once,
// remember the answer, and only auto-hand-off for someone who has already
// told us the app exists. Nobody without it ever sees a broken dialog.

const PROTOCOL = "golive";

export function OpenInAppBanner({ handle }: { handle: string }) {
  // Every decision here depends on localStorage and on whether we are inside
  // the app, neither of which exists during the server render — so the
  // banner renders nothing until after mount rather than guessing and
  // hydrating into a mismatch.
  const [state, setState] = useState<"pending" | "hidden" | "offer">("pending");

  // Deferred by a tick rather than set synchronously in the effect body:
  // setting state there forces a second render pass before the browser
  // paints, which is the cascading-render pattern React 19 warns about.
  // Matches the same gate in WatchRoom and the home page.
  useEffect(() => {
    const id = setTimeout(() => {
      // Already in the app: there is nothing to hand off to.
      if (isDesktopApp()) {
        setState("hidden");
        return;
      }
      // No mobile build exists (see electron-builder.yml — Windows, macOS
      // and Linux only), so on a phone this would be offering something
      // that cannot be installed. Uses the same detection the /download
      // route and the download button use, so "no desktop build for you"
      // means the same thing in all three places.
      if (!detectDownloadPlatform(navigator.userAgent)) {
        setState("hidden");
        return;
      }
      if (getStoredOpenRoomsInApp()) {
        // They have told us the app is there, so skip the asking.
        setState("hidden");
        openInApp(handle);
        return;
      }
      setState(getStoredOpenInAppDismissed() ? "hidden" : "offer");
    }, 0);
    return () => clearTimeout(id);
  }, [handle]);

  if (state !== "offer") return null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-black/10 bg-zinc-100 px-3 py-2 text-sm dark:border-white/10 dark:bg-zinc-900 sm:px-4">
      <MdOutlineDesktopWindows className="h-4 w-4 shrink-0 text-zinc-500 dark:text-zinc-400" />
      <span className="text-zinc-700 dark:text-zinc-300">
        Não ouça eco (ouvir sua própria voz na transmissão do amigo) utilizando o app oficial do Go Live!
      </span>
      <span className="ml-auto flex items-center gap-2">
        <DownloadAppButton source="room-banner" />
        <button
          type="button"
          onClick={() => {
            // Remembered *before* navigating: the protocol handoff can take
            // the focus away instantly, and a write after that is not
            // guaranteed to land.
            setStoredOpenRoomsInApp(true);
            setState("hidden");
            openInApp(handle);
          }}
          className="rounded-lg bg-zinc-950 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
        >
          Abrir no app
        </button>
        <button
          type="button"
          onClick={() => {
            setStoredOpenInAppDismissed(true);
            setState("hidden");
          }}
          className="rounded-lg px-2 py-1.5 text-xs font-medium text-zinc-500 transition hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          Agora não
        </button>
      </span>
    </div>
  );
}

// The handoff itself. `golive://watch/<handle>` is what electron/main.ts
// listens for; the app validates the handle again on its side rather than
// trusting whatever invoked the protocol.
//
// The page is deliberately left as it is — not closed, not navigated away.
// If nothing handles the scheme, the room the person is already in keeps
// working, and the only cost is a dialog they dismiss.
function openInApp(handle: string) {
  // Not an internal Next route, so the router is the wrong tool and the lint
  // rule's advice does not apply: this is a handoff to another *application*
  // over a custom OS protocol, which only a real navigation can trigger.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.href = `${PROTOCOL}://watch/${encodeURIComponent(handle)}`;
}
