"use client";

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { GifResult } from "@/app/api/giphy/search/route";

// Debounce delay between keystrokes and firing a search — short enough to
// feel live, long enough that a fast typist doesn't fire a request per
// character.
const SEARCH_DEBOUNCE_MS = 350;

// Must match the panel's fixed w-72/h-80 below — used to keep it inside the
// viewport when the anchor button sits near an edge.
const PICKER_WIDTH = 288;
const PICKER_HEIGHT = 320;
const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 8;

export function GifPicker({
  anchorRef,
  onSelect,
  onClose,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  onSelect: (gif: GifResult) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GifResult[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "unavailable">("loading");
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Renders through a portal, positioned by the anchor button's actual
  // screen coordinates, instead of `position: absolute` inside ChatPanel —
  // that panel clips overflow for its scrolling message list, which cut off
  // the popover whenever it had less room above the input than the
  // picker's own height.
  useLayoutEffect(() => {
    function reposition() {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const left = Math.min(
        Math.max(rect.left, VIEWPORT_MARGIN),
        window.innerWidth - PICKER_WIDTH - VIEWPORT_MARGIN
      );
      const top = Math.min(
        Math.max(rect.top - PICKER_HEIGHT - ANCHOR_GAP, VIEWPORT_MARGIN),
        window.innerHeight - PICKER_HEIGHT - VIEWPORT_MARGIN
      );
      setPosition({ top, left });
    }
    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [anchorRef]);

  useEffect(() => {
    const timer = setTimeout(async () => {
      setStatus("loading");
      try {
        const res = await fetch(`/api/giphy/search?q=${encodeURIComponent(query)}`);
        if (res.status === 404) {
          setStatus("unavailable");
          return;
        }
        if (!res.ok) {
          setStatus("error");
          return;
        }
        const body = (await res.json()) as { results: GifResult[] };
        setResults(body.results);
        setStatus("ready");
      } catch {
        setStatus("error");
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (containerRef.current?.contains(target)) return;
      // The button that opens the picker toggles it via its own onClick —
      // without this exemption, this document-level listener would fire
      // first and close it, and the button's handler would then reopen it.
      if (anchorRef.current?.contains(target)) return;
      onClose();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, anchorRef]);

  if (!position) return null;

  return createPortal(
    <div
      ref={containerRef}
      style={{ top: position.top, left: position.left }}
      className="fixed z-50 flex h-80 w-72 flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="border-b border-zinc-200 p-2 dark:border-zinc-800">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar GIFs..."
          maxLength={100}
          className="w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {status === "unavailable" && (
          <p className="my-auto text-center text-sm text-zinc-500 dark:text-zinc-500">
            Busca de GIFs indisponível.
          </p>
        )}
        {status === "error" && (
          <p className="my-auto text-center text-sm text-zinc-500 dark:text-zinc-500">
            Falha ao buscar GIFs. Tente novamente.
          </p>
        )}
        {status === "loading" && results.length === 0 && (
          <p className="my-auto text-center text-sm text-zinc-500 dark:text-zinc-500">Buscando...</p>
        )}
        {(status === "ready" || status === "loading") && results.length > 0 && (
          <div className="grid grid-cols-3 gap-1.5">
            {results.map((gif) => (
              <button
                key={gif.id}
                type="button"
                onClick={() => onSelect(gif)}
                className="aspect-square overflow-hidden rounded-md bg-zinc-100 outline-none hover:ring-2 hover:ring-zinc-400 focus-visible:ring-2 focus-visible:ring-zinc-500 dark:bg-zinc-800"
              >
                {/* Giphy renditions are already-compressed GIFs — next/image
                    would need a remote-pattern allowlist for every Giphy CDN
                    subdomain and re-encoding risks breaking the animation. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={gif.previewUrl}
                  alt={gif.title}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              </button>
            ))}
          </div>
        )}
        {status === "ready" && results.length === 0 && (
          <p className="my-auto text-center text-sm text-zinc-500 dark:text-zinc-500">
            Nenhum GIF encontrado.
          </p>
        )}
      </div>

      <div className="border-t border-zinc-200 px-2 py-1 text-right text-[10px] text-zinc-400 dark:border-zinc-800 dark:text-zinc-600">
        Powered by GIPHY
      </div>
    </div>,
    document.body
  );
}
