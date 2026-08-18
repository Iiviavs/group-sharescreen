"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  SpeakerIcon,
  SpeakerMuteIcon,
  PipIcon,
  PipExitIcon,
  FullscreenIcon,
  FullscreenExitIcon,
  EyeOffIcon,
  ArrowLeftIcon,
} from "@/components/icons";

function noopSubscribe() {
  return () => {};
}
function getPipSupported() {
  return typeof document !== "undefined" && Boolean(document.pictureInPictureEnabled);
}
function getPipSupportedServer() {
  return false;
}

export function VideoTile({
  stream,
  label,
  badge,
  muted = false,
  allowUnmute = true,
  fill = false,
  onStopWatching,
}: {
  stream: MediaStream;
  label: string;
  badge?: string;
  muted?: boolean;
  allowUnmute?: boolean;
  // When true (the lone tile in the room), grow to fill the available
  // space instead of staying locked to a 16:9 card like the grid view.
  fill?: boolean;
  // Only passed for remote peers — lets the viewer stop receiving this
  // specific stream (see WatchRoom/useRoomMedia) without affecting anyone
  // else's tile. Omitted for the local "Você" tile, which has nothing to
  // stop watching.
  onStopWatching?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isMuted, setIsMuted] = useState(muted);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPiP, setIsPiP] = useState(false);
  const pipSupported = useSyncExternalStore(noopSubscribe, getPipSupported, getPipSupportedServer);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = isMuted;
  }, [isMuted]);

  useEffect(() => {
    function onFullscreenChange() {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    }
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onEnter = () => setIsPiP(true);
    const onLeave = () => setIsPiP(false);
    video.addEventListener("enterpictureinpicture", onEnter);
    video.addEventListener("leavepictureinpicture", onLeave);
    return () => {
      video.removeEventListener("enterpictureinpicture", onEnter);
      video.removeEventListener("leavepictureinpicture", onLeave);
    };
  }, []);

  async function toggleFullscreen() {
    if (!containerRef.current) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await containerRef.current.requestFullscreen();
      }
    } catch {
      // ignored - fullscreen may be blocked by the browser
    }
  }

  async function togglePiP() {
    if (!videoRef.current) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await videoRef.current.requestPictureInPicture();
      }
    } catch {
      // ignored - PiP requires a direct user gesture and may be unsupported
    }
  }

  return (
    <div
      ref={containerRef}
      className={`relative w-full overflow-hidden rounded-xl border border-white/10 bg-black ${
        fill ? "h-full min-h-[240px]" : "aspect-video"
      }`}
    >
      <video ref={videoRef} autoPlay playsInline className="h-full w-full object-contain bg-black" />
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/85 to-transparent px-3 py-2">
        <span className="truncate text-sm font-medium text-white">{label}</span>
        {badge && (
          <span className="rounded-full bg-red-500/90 px-2 py-0.5 text-xs font-semibold text-white">
            {badge}
          </span>
        )}
      </div>
      <div className="absolute right-2 top-2 flex flex-wrap items-center justify-end gap-1.5">
        {allowUnmute && (
          <button
            type="button"
            onClick={() => setIsMuted((m) => !m)}
            title={isMuted ? "Ativar som" : "Silenciar"}
            aria-label={isMuted ? "Ativar som" : "Silenciar"}
            className="rounded-full bg-black/60 p-1.5 text-white hover:bg-black/80 active:bg-black/80"
          >
            {isMuted ? <SpeakerMuteIcon className="h-4 w-4" /> : <SpeakerIcon className="h-4 w-4" />}
          </button>
        )}
        {pipSupported && (
          <button
            type="button"
            onClick={togglePiP}
            title={isPiP ? "Sair do picture-in-picture" : "Picture-in-picture"}
            aria-label={isPiP ? "Sair do picture-in-picture" : "Picture-in-picture"}
            className="rounded-full bg-black/60 p-1.5 text-white hover:bg-black/80 active:bg-black/80"
          >
            {isPiP ? <PipExitIcon className="h-4 w-4" /> : <PipIcon className="h-4 w-4" />}
          </button>
        )}
        <button
          type="button"
          onClick={toggleFullscreen}
          title={isFullscreen ? "Sair da tela cheia" : "Tela cheia"}
          aria-label={isFullscreen ? "Sair da tela cheia" : "Tela cheia"}
          className="rounded-full bg-black/60 p-1.5 text-white hover:bg-black/80 active:bg-black/80"
        >
          {isFullscreen ? <FullscreenExitIcon className="h-4 w-4" /> : <FullscreenIcon className="h-4 w-4" />}
        </button>
        {onStopWatching && (
          <button
            type="button"
            onClick={onStopWatching}
            title="Parar de assistir"
            aria-label="Parar de assistir"
            className="rounded-full bg-black/60 p-1.5 text-white hover:bg-black/80 active:bg-black/80"
          >
            <EyeOffIcon className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

export function StoppedPeerTile({
  label,
  fill = false,
  onResume,
}: {
  label: string;
  fill?: boolean;
  onResume: () => void;
}) {
  return (
    <div
      className={`relative flex w-full flex-col items-center justify-center gap-3 overflow-hidden rounded-xl border border-white/10 bg-black px-4 text-center ${
        fill ? "h-full min-h-[240px]" : "aspect-video"
      }`}
    >
      <p className="text-sm text-zinc-300">
        Você saiu dessa transmissão
        <br />
        <span className="text-zinc-500">({label})</span>
      </p>
      <button
        type="button"
        onClick={onResume}
        className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-white/20"
      >
        <ArrowLeftIcon className="h-4 w-4" />
        Voltar
      </button>
    </div>
  );
}
