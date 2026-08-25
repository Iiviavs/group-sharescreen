"use client";

import { useState } from "react";
import { launchDesktopUpdate } from "@/lib/adminApi";

// One button, for the minute right after a GitHub release goes from draft to
// published (see electron-builder.yml's `releaseType: draft` — that press is
// the real go-live moment, this one just spreads the word).
//
// It does not push a version, and it cannot make the install button appear on
// a machine that has nothing to install. All it does is collapse the six-hour
// wait until each app would have noticed on its own.
export function DesktopUpdatePanel() {
  const [launching, setLaunching] = useState(false);
  const [notified, setNotified] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleLaunch() {
    if (launching) return;
    setLaunching(true);
    setError(null);
    setNotified(null);
    try {
      setNotified(await launchDesktopUpdate());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao avisar.");
    } finally {
      setLaunching(false);
    }
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
        Lançar atualização do app
      </h2>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        Avisa por websocket todos os apps abertos para procurarem uma nova versão agora, em vez
        de esperarem a checagem automática (a cada 6 horas). Quem tiver uma versão nova para
        instalar vê o botão verde de atualizar em poucos segundos; quem já está na mais recente
        não vê nada. Use logo depois de publicar o release no GitHub — enquanto ele estiver como
        rascunho, os apps não encontram nada.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleLaunch}
          disabled={launching}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {launching ? "Avisando..." : "Lançar atualização"}
        </button>
        {notified !== null && (
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            {/* Connections, not desktop apps: the server can't tell a browser
                tab from the app — both are the same site on the same socket. */}
            Avisadas {notified} {notified === 1 ? "conexão" : "conexões"} (apps e navegadores).
          </span>
        )}
        {error && <span className="text-sm text-red-500">{error}</span>}
      </div>
    </div>
  );
}
