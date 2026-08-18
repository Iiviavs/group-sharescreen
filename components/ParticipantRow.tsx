"use client";

import { useSpeaking } from "@/lib/useSpeaking";
import { MicIcon, ScreenIcon, SpeakerIcon, SpeakerMuteIcon } from "./icons";

export function ParticipantRow({
  name,
  isSelf = false,
  micOn,
  sharing,
  micStream,
  muted = false,
  onToggleMute,
}: {
  name: string;
  isSelf?: boolean;
  micOn: boolean;
  sharing: boolean;
  micStream?: MediaStream | null;
  muted?: boolean;
  onToggleMute?: () => void;
}) {
  const speaking = useSpeaking(micOn ? micStream : null);

  return (
    <li
      className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm ${
        isSelf ? "bg-zinc-100 dark:bg-zinc-900" : "text-zinc-700 dark:text-zinc-300"
      }`}
    >
      <span
        className={`truncate font-medium transition-colors ${
          speaking
            ? "text-emerald-600 dark:text-emerald-400"
            : isSelf
              ? "text-zinc-900 dark:text-zinc-100"
              : ""
        }`}
      >
        {name}
        {isSelf && <span className="font-normal text-zinc-500"> (você)</span>}
      </span>
      <span className="flex shrink-0 items-center gap-2 text-zinc-400 dark:text-zinc-500">
        {micOn && <MicIcon className="h-4 w-4 text-sky-500" />}
        {sharing && <ScreenIcon className="h-4 w-4 text-emerald-500" />}
        {!isSelf && onToggleMute && (
          <button
            type="button"
            onClick={onToggleMute}
            title={muted ? "Reativar áudio" : "Silenciar áudio"}
            className="rounded p-1 transition hover:text-zinc-700 dark:hover:text-zinc-200"
          >
            {muted ? <SpeakerMuteIcon className="h-4 w-4" /> : <SpeakerIcon className="h-4 w-4" />}
          </button>
        )}
      </span>
    </li>
  );
}
