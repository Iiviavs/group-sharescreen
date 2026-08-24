"use client";

import Link from "next/link";
import { useSpeaking } from "@/lib/useSpeaking";
import { MicIcon, MicOffIcon, ScreenIcon } from "./icons";
import { MdOutlineOndemandVideo } from "react-icons/md";
import { VolumeSlider } from "./VolumeSlider";
import { DisplayUserName } from "./DisplayUserName";
import { Tooltip } from "./Tooltip";
import { MAX_GAIN } from "@/lib/audioGain";

export function ParticipantRow({
  name,
  isSelf = false,
  isGuest = false,
  userId,
  micOn,
  sharing,
  sharingVideo = false,
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
  // Account id (see server/signaling.ts's peerSummary) — only ever a real,
  // viewable profile when the peer isn't a guest. Undefined for a peer sent
  // by an older server version that doesn't include it yet, same as isGuest.
  userId?: string;
  micOn: boolean;
  sharing: boolean;
  // Whether this person has a room video source on screen (see
  // components/VideoSourceTile) — a different thing from `sharing`, which is
  // about transmitting their own screen or camera. Shown with its own icon
  // because it also says who is allowed to play/pause it.
  sharingVideo?: boolean;
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
  // A guest has no account behind it — nowhere for /user/[id] to point — and
  // an older server that doesn't send userId yet leaves this peer
  // unclickable rather than linking to a broken profile.
  const canOpenProfile = !isGuest && Boolean(userId);
  const nameElement = (
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
  );

  return (
    <li
      className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm ${
        isSelf ? "bg-zinc-100 dark:bg-zinc-900" : "text-zinc-700 dark:text-zinc-300"
      }`}
    >
      <span className="flex min-w-0 items-baseline gap-1">
        {canOpenProfile ? (
          <Link href={`/user/${userId}`} target="_blank" className="min-w-0 hover:underline">
            {nameElement}
          </Link>
        ) : (
          nameElement
        )}
        {isSelf && <span className="shrink-0 text-xs font-normal text-zinc-500">(você)</span>}
      </span>
      <span className="flex shrink-0 items-center gap-2 text-zinc-400 dark:text-zinc-500">
        {micOn ? (
          <MicIcon className="h-4 w-4 text-sky-500" />
        ) : (
          <MicOffIcon className="h-4 w-4 text-zinc-400 dark:text-zinc-600" />
        )}
        {sharing && <ScreenIcon className="h-4 w-4 text-emerald-500" />}
        {sharingVideo && (
          <Tooltip content={`${name} adicionou uma ou mais fontes de vídeo`}>
            <span className="flex shrink-0 items-center">
              <MdOutlineOndemandVideo className="h-4 w-4 text-red-500" />
            </span>
          </Tooltip>
        )}
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
