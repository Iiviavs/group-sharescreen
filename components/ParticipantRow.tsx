"use client";

import { useSpeaking } from "@/lib/useSpeaking";
import { MicIcon, MicOffIcon, ScreenIcon } from "./icons";
import { VolumeSlider } from "./VolumeSlider";
import { DisplayUserName } from "./DisplayUserName";
import { MAX_GAIN } from "@/lib/audioGain";

export function ParticipantRow({
  name,
  isSelf = false,
  isGuest = false,
  micOn,
  sharing,
  micStream,
  muted = false,
  onToggleMute,
  volume = 1,
  onVolumeChange,
  connectionLost = false,
  verified = false,
}: {
  name: string;
  isSelf?: boolean;
  isGuest?: boolean;
  micOn: boolean;
  sharing: boolean;
  micStream?: MediaStream | null;
  muted?: boolean;
  onToggleMute?: () => void;
  volume?: number;
  onVolumeChange?: (volume: number) => void;
  // This peer's audio peer connection is down (failed/disconnected) while we
  // still expect one — see useRoomMedia's recvConnectionStates.
  connectionLost?: boolean;
  verified?: boolean;
}) {
  const speaking = useSpeaking(micOn ? micStream : null);

  return (
    <li
      className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm ${
        isSelf ? "bg-zinc-100 dark:bg-zinc-900" : "text-zinc-700 dark:text-zinc-300"
      }`}
    >
      <span className="flex min-w-0 items-baseline gap-1">
        <DisplayUserName
          name={name}
          isGuest={isGuest}
          verified={verified}
          connectionLost={connectionLost}
          className={`truncate font-medium transition-colors ${
            speaking
              ? "text-emerald-600 dark:text-emerald-400"
              : isSelf
                ? "text-zinc-900 dark:text-zinc-100"
                : ""
          }`}
        />
        {isSelf && <span className="shrink-0 text-xs font-normal text-zinc-500">(você)</span>}
      </span>
      <span className="flex shrink-0 items-center gap-2 text-zinc-400 dark:text-zinc-500">
        {micOn ? (
          <MicIcon className="h-4 w-4 text-sky-500" />
        ) : (
          <MicOffIcon className="h-4 w-4 text-zinc-400 dark:text-zinc-600" />
        )}
        {sharing && <ScreenIcon className="h-4 w-4 text-emerald-500" />}
        {!isSelf && onVolumeChange && (
          <VolumeSlider
            value={volume}
            label={`Volume do áudio de ${name}`}
            onChange={onVolumeChange}
            muted={muted}
            onToggleMute={onToggleMute}
            collapseOnIdle
            max={MAX_GAIN}
            className="text-zinc-400 dark:text-zinc-500"
          />
        )}
      </span>
    </li>
  );
}
