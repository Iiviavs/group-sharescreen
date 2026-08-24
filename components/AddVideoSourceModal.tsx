"use client";

import { useState, type FormEvent } from "react";
import { FaYoutube, FaTwitch } from "react-icons/fa";
import { parseYouTubeVideoId, parseTwitchChannel } from "@/lib/videoSource";
import { BetaMark } from "./BetaMark";

export type AddVideoSourcePopupData = {
  onSubmit: (kind: "youtube" | "twitch", url: string, controlMode: "owner" | "anyone") => void;
};

const PLATFORMS: {
  id: "youtube" | "twitch";
  label: string;
  placeholder: string;
  icon: typeof FaYoutube;
  activeClassName: string;
}[] = [
  {
    id: "youtube",
    label: "YouTube",
    placeholder: "https://youtube.com/watch?v=...",
    icon: FaYoutube,
    activeClassName: "border-red-600 bg-red-600/10 text-red-600 dark:text-red-500",
  },
  {
    id: "twitch",
    label: "Twitch",
    placeholder: "https://twitch.tv/canal",
    icon: FaTwitch,
    activeClassName: "border-[#9146FF] bg-[#9146FF]/10 text-[#9146FF]",
  },
];

// The popup behind the header/empty-pane "Adicionar fonte de vídeo" buttons
// (see WatchRoom.tsx) — an ntpopups popup type, registered as
// "add_video_source" in NtPopups.tsx, same pattern as PartnerRewardModal.
// Platform first, on purpose: the link field is disabled until one is
// picked, both because the placeholder/validation depend on which platform
// it is and because there is nothing sensible to paste before that choice —
// a link alone doesn't say whether it's a YouTube or Twitch address.
export function AddVideoSourceModal({
  closePopup,
  data: { onSubmit },
}: {
  closePopup: (hasAction?: boolean) => void;
  data: AddVideoSourcePopupData;
}) {
  const [kind, setKind] = useState<"youtube" | "twitch" | null>(null);
  // Defaults to "owner" — whoever adds a source keeping the wheel unless
  // they deliberately open it up is the same rule the room has always had,
  // just made visible instead of implicit.
  const [controlMode, setControlMode] = useState<"owner" | "anyone">("owner");
  const [link, setLink] = useState("");
  const [error, setError] = useState<string | null>(null);

  const platform = PLATFORMS.find((p) => p.id === kind) ?? null;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!kind) return;
    const raw = link.trim();
    if (!raw) return;
    // Only to catch an obvious paste mistake without a round trip — the
    // server parses it again, and its answer is what everyone embeds.
    const valid = kind === "youtube" ? parseYouTubeVideoId(raw) : parseTwitchChannel(raw);
    if (!valid) {
      setError(
        kind === "youtube"
          ? "Cole um link de vídeo ou live do YouTube."
          : "Cole um link ou o nome de um canal da Twitch."
      );
      return;
    }
    onSubmit(kind, raw, controlMode);
    closePopup(true);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex w-80 max-w-[calc(100vw-1rem)] flex-col gap-4 bg-white p-4 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold">
          <BetaMark /> Adicionar fonte de vídeo
        </p>
        <button
          type="button"
          onClick={() => closePopup(false)}
          aria-label="Fechar"
          className="-mr-1 -mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-lg leading-none opacity-60 transition hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10"
        >
          ×
        </button>
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Plataforma</p>
        <div className="flex gap-2">
          {PLATFORMS.map((p) => {
            const Icon = p.icon;
            const selected = kind === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setKind(p.id);
                  setError(null);
                }}
                aria-pressed={selected}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition ${
                  selected
                    ? p.activeClassName
                    : "border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {p.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Quem pode controlar</p>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="video-source-control-mode"
            checked={controlMode === "owner"}
            onChange={() => setControlMode("owner")}
          />
          Só eu posso controlar
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="video-source-control-mode"
            checked={controlMode === "anyone"}
            onChange={() => setControlMode("anyone")}
          />
          Qualquer um pode controlar
        </label>
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Link</p>
        <input
          value={link}
          onChange={(e) => {
            setLink(e.target.value);
            setError(null);
          }}
          disabled={!kind}
          placeholder={platform ? platform.placeholder : "Escolha uma plataforma primeiro"}
          aria-label="Link do vídeo"
          className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>

      <button
        type="submit"
        disabled={!kind || !link.trim()}
        className="w-full rounded-lg bg-zinc-950 px-3 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
      >
        Adicionar
      </button>
    </form>
  );
}
