"use client";

import { useEffect, useState } from "react";
import { DownloadIcon } from "@/components/icons";
import { Tooltip } from "@/components/Tooltip";
import { getDesktopBridge } from "@/lib/desktop";
import { trackEvent } from "@/lib/analytics";

// "A new version is ready — press when you feel like it."
//
// The desktop shell downloads its own updates in the background and installs
// them on quit no matter what (see electron/updater.ts). This button exists
// only to offer the shortcut: it is the entire replacement for a modal that
// used to interrupt calls to ask the same question. Everything about it is
// shaped by that — it is small, it is a corner, it never blocks anything, and
// ignoring it forever is a perfectly good outcome.
//
// Renders nothing at all in a browser: `getDesktopBridge()` is null there, and
// so it is in any desktop build older than the one that added these methods,
// which is why each is called defensively rather than assumed present.
export function UpdateAppButton() {
  const [version, setVersion] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    const bridge = getDesktopBridge();
    if (!bridge) return;

    // Asked *and* subscribed, because either one alone loses the update
    // half the time: the download usually finishes while some other page is
    // mounted (or none is), and a page that outlives the download would
    // never hear about it without the listener.
    let cancelled = false;
    void bridge
      .pendingUpdate?.()
      .then((pending) => {
        if (!cancelled) setVersion(pending);
      })
      .catch(() => {
        // An older shell whose main process has no handler for this channel.
        // No update offer is the correct outcome there.
      });
    const unsubscribe = bridge.onUpdateReady?.((ready) => setVersion(ready));

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  if (!version) return null;

  function handleInstall() {
    const bridge = getDesktopBridge();
    if (!bridge?.installUpdate) return;
    trackEvent("desktop_update_installed", { version });
    // Latched before the call: quitAndInstall tears the app down over a
    // second or so, and a button that still looks idle through that reads as
    // "nothing happened" and invites a second press.
    setInstalling(true);
    bridge.installUpdate();
  }

  return (
    <Tooltip
      content={installing ? "Reiniciando…" : `Instalar atualização (${version})`}
      placement="bottom"
    >
      <button
        type="button"
        onClick={handleInstall}
        disabled={installing}
        aria-label="Instalar atualização"
        className="fixed right-4 top-4 z-50 flex h-10 w-10 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg transition hover:bg-emerald-500 disabled:opacity-70 dark:bg-emerald-500 dark:hover:bg-emerald-400"
      >
        <DownloadIcon className="h-5 w-5" />
      </button>
    </Tooltip>
  );
}
