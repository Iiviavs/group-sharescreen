"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ChatMessage } from "@/lib/signalingClient";

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function ChatPanel({
  messages,
  selfId,
  onSend,
}: {
  messages: ChatMessage[];
  selfId: string | null;
  // Omitted for a read-only viewer (the admin moderation view) — hides the
  // input form instead of sending into a room the viewer isn't a member of.
  onSend?: (text: string) => void;
}) {
  const [input, setInput] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  // Keeps the newest message in view as they arrive, without fighting the
  // user if they've scrolled up to read older ones.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [messages]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!input.trim() || !onSend) return;
    onSend(input);
    setInput("");
  }

  return (
    <div className="mt-4 flex h-72 flex-col overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
      <h2 className="border-b border-zinc-200 px-3 py-2 text-sm font-semibold text-zinc-700 dark:border-zinc-800 dark:text-zinc-300">
        Chat
      </h2>

      <div ref={listRef} className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 py-2">
        {messages.length === 0 ? (
          <p className="my-auto text-center text-sm text-zinc-500 dark:text-zinc-500">
            Nenhuma mensagem ainda.
          </p>
        ) : (
          messages.map((m) => {
            const isSelf = m.from === selfId;
            return (
              <div key={m.id} className="text-sm">
                <div className="flex items-baseline gap-1.5">
                  <span
                    className={`font-medium ${
                      isSelf ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-700 dark:text-zinc-300"
                    }`}
                  >
                    {isSelf ? "Você" : m.name}
                  </span>
                  <span className="text-xs text-zinc-400 dark:text-zinc-600">{formatTime(m.ts)}</span>
                </div>
                <p className="break-words text-zinc-800 dark:text-zinc-200">{m.text}</p>
              </div>
            );
          })
        )}
      </div>

      {onSend && (
        <form onSubmit={handleSubmit} className="flex gap-2 border-t border-zinc-200 p-2 dark:border-zinc-800">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            maxLength={500}
            placeholder="Digite uma mensagem..."
            className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
          <button
            type="submit"
            disabled={!input.trim()}
            className="shrink-0 rounded-md bg-zinc-950 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            Enviar
          </button>
        </form>
      )}
    </div>
  );
}
