"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  clearAnnouncement,
  fetchCurrentAnnouncement,
  sendAnnouncement,
  type Announcement,
  type AnnouncementButtonAction,
  type AnnouncementColor,
} from "@/lib/adminApi";
import { AnnouncementBar } from "@/components/AnnouncementBar";

const ACTION_OPTIONS: { value: AnnouncementButtonAction; label: string }[] = [
  { value: "open-new-tab", label: "Abrir link em nova guia" },
  { value: "open-same-tab", label: "Abrir link na guia atual" },
  { value: "reload", label: "Recarregar a página" },
];

const COLOR_OPTIONS: { value: AnnouncementColor; label: string }[] = [
  { value: "blue", label: "Azul" },
  { value: "green", label: "Verde" },
  { value: "red", label: "Vermelho" },
];

export function AnnouncementPanel() {
  // undefined = still loading the current state from the server.
  const [active, setActive] = useState<Announcement | null | undefined>(undefined);

  const [text, setText] = useState("");
  const [buttonLabel, setButtonLabel] = useState("");
  const [buttonAction, setButtonAction] = useState<AnnouncementButtonAction>("open-new-tab");
  const [buttonUrl, setButtonUrl] = useState("");
  const [color, setColor] = useState<AnnouncementColor>("blue");
  const [dismissible, setDismissible] = useState(true);

  const [previewing, setPreviewing] = useState(false);
  const [sending, setSending] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchCurrentAnnouncement()
      .then((a) => {
        if (!cancelled) setActive(a);
      })
      .catch(() => {
        if (!cancelled) setActive(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const needsUrl = buttonAction !== "reload";

  const previewAnnouncement: Announcement = {
    id: "preview",
    text: text.trim() || "O texto do aviso aparece aqui.",
    buttonLabel: buttonLabel.trim() || "Botão",
    buttonAction,
    buttonUrl: needsUrl ? buttonUrl.trim() || null : null,
    color,
    dismissible,
  };

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSending(true);
    try {
      const announcement = await sendAnnouncement({
        text: text.trim(),
        buttonLabel: buttonLabel.trim(),
        buttonAction,
        buttonUrl: needsUrl ? buttonUrl.trim() : undefined,
        color,
        dismissible,
      });
      setActive(announcement);
      setPreviewing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao enviar aviso.");
    } finally {
      setSending(false);
    }
  }

  async function handleClear() {
    setClearing(true);
    setError(null);
    try {
      await clearAnnouncement();
      setActive(null);
    } catch {
      setError("Falha ao remover aviso.");
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="mb-8 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Aviso do site</h2>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        Envia uma mensagem no topo do site para todo mundo conectado agora.
      </p>

      {active && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          <span className="min-w-0 flex-1 truncate">Há um aviso ativo agora: &quot;{active.text}&quot;</span>
          <button
            type="button"
            onClick={handleClear}
            disabled={clearing}
            className="shrink-0 font-semibold underline underline-offset-2 disabled:opacity-50"
          >
            {clearing ? "Removendo..." : "Remover"}
          </button>
        </div>
      )}

      <form onSubmit={handleSend} className="mt-4 flex flex-col gap-3">
        <div>
          <label
            htmlFor="announcement-text"
            className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
          >
            Texto
          </label>
          <textarea
            id="announcement-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={300}
            rows={2}
            placeholder="Ex: Manutenção programada às 22h."
            className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label
              htmlFor="announcement-button-label"
              className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
            >
              Label do botão
            </label>
            <input
              id="announcement-button-label"
              value={buttonLabel}
              onChange={(e) => setButtonLabel(e.target.value)}
              maxLength={40}
              placeholder="Ex: Saiba mais"
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
          </div>
          <div>
            <label
              htmlFor="announcement-action"
              className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
            >
              Ação do botão
            </label>
            <select
              id="announcement-action"
              value={buttonAction}
              onChange={(e) => setButtonAction(e.target.value as AnnouncementButtonAction)}
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            >
              {ACTION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {needsUrl && (
          <div>
            <label
              htmlFor="announcement-url"
              className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
            >
              Link
            </label>
            <input
              id="announcement-url"
              value={buttonUrl}
              onChange={(e) => setButtonUrl(e.target.value)}
              placeholder="https://..."
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:items-end">
          <div>
            <label
              htmlFor="announcement-color"
              className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
            >
              Cor
            </label>
            <select
              id="announcement-color"
              value={color}
              onChange={(e) => setColor(e.target.value as AnnouncementColor)}
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            >
              {COLOR_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
            <input
              type="checkbox"
              checked={dismissible}
              onChange={(e) => setDismissible(e.target.checked)}
              className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-700"
            />
            Mostrar &quot;x&quot; para fechar
          </label>
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="mt-1 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setPreviewing((p) => !p)}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            {previewing ? "Ocultar preview" : "Preview"}
          </button>
          <button
            type="submit"
            disabled={sending || !text.trim() || !buttonLabel.trim() || (needsUrl && !buttonUrl.trim())}
            className="rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            {sending ? "Enviando..." : "Enviar aviso"}
          </button>
        </div>
      </form>

      {previewing && (
        <div className="mt-4 overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
          <AnnouncementBar announcement={previewAnnouncement} onDismiss={() => setPreviewing(false)} />
        </div>
      )}
    </div>
  );
}
