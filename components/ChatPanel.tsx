"use client";

import { useLayoutEffect, useRef, useState, type FormEvent } from "react";
import type { ChatMessage } from "@/lib/signalingClient";
import type { GifResult } from "@/app/api/giphy/search/route";
import { GifPicker } from "@/components/GifPicker";

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

const URL_PATTERN = /(https?:\/\/[^\s]+|www\.[^\s]+)/g;

function linkifyText(text: string) {
  const parts = text.split(URL_PATTERN);
  return parts.map((part, i) => {
    if (!part.match(URL_PATTERN)) return part;
    const href = part.startsWith("www.") ? `https://${part}` : part;
    return (
      <a
        key={i}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-2 hover:text-zinc-950 dark:hover:text-white"
      >
        {part}
      </a>
    );
  });
}

export function ChatPanel({
  messages,
  selfId,
  onSend,
  onSendGif,
  blockedMessage,
}: {
  messages: ChatMessage[];
  selfId: string | null;
  // Omitted for a read-only viewer (the admin moderation view) — hides the
  // input form instead of sending into a room the viewer isn't a member of.
  onSend?: (text: string) => void;
  onSendGif?: (url: string) => void;
  // Set when the server rejected the last message for containing a banned
  // word (see signalingClient's chatBlockedMessage) — shown once, right
  // above the input, and cleared by the client on the next send attempt.
  blockedMessage?: string | null;
}) {
  const [input, setInput] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const gifButtonRef = useRef<HTMLButtonElement>(null);
  // Tracks whether we've already jumped to bottom for the current batch of
  // messages, so a room's preloaded history opens scrolled to the bottom
  // (like a real chat) instead of at the top where it first renders.
  const initializedRef = useRef(false);

  // Keeps the newest message in view as they arrive, without fighting the
  // user if they've scrolled up to read older ones.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (messages.length === 0) {
      initializedRef.current = false;
      return;
    }
    if (!initializedRef.current) {
      el.scrollTop = el.scrollHeight;
      initializedRef.current = true;
      return;
    }
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [messages]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!input.trim() || !onSend) return;
    onSend(input);
    setInput("");
  }

  function handleGifSelect(gif: GifResult) {
    setPickerOpen(false);
    onSendGif?.(gif.url);
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
                {m.kind === "gif" && m.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.url} alt="GIF" className="mt-1 max-h-40 max-w-full rounded-md" />
                ) : (
                  <p className="break-words text-zinc-800 dark:text-zinc-200">{linkifyText(m.text)}</p>
                )}
              </div>
            );
          })
        )}
      </div>

      {blockedMessage && (
        <p className="border-t border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-600 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400">
          {blockedMessage}
        </p>
      )}

      {onSend && (
        <form
          onSubmit={handleSubmit}
          className="flex gap-2 border-t border-zinc-200 p-2 dark:border-zinc-800"
        >
          {pickerOpen && (
            <GifPicker
              anchorRef={gifButtonRef}
              onSelect={handleGifSelect}
              onClose={() => setPickerOpen(false)}
            />
          )}
          {onSendGif && (
            <button
              ref={gifButtonRef}
              type="button"
              onClick={() => setPickerOpen((open) => !open)}
              aria-label="Adicionar GIF"
              aria-expanded={pickerOpen}
              className="shrink-0 rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              GIF
            </button>
          )}
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
