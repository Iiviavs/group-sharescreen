"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { SpeakerIcon, SpeakerMuteIcon } from "./icons";

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
}: {
  stream: MediaStream;
  label: string;
  badge?: string;
  muted?: boolean;
  allowUnmute?: boolean;
  // When true (the lone tile in the room), grow to fill the available
  // space instead of staying locked to a 16:9 card like the grid view.
  fill?: boolean;
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
        fill ? "h-full min-h-60" : "aspect-video"
      }`}
    >
      <video ref={videoRef} autoPlay playsInline className="h-full w-full object-contain bg-black" />
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-linear-to-t from-black/85 to-transparent px-3 py-2">
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
            className="rounded-full bg-black/60 p-2 text-white hover:bg-black/80 active:bg-black/80"
          >
            {isMuted ? <SpeakerMuteIcon className="h-4 w-4" /> : <SpeakerIcon className="h-4 w-4" />}
          </button>
        )}
        {pipSupported && (
          <button
            type="button"
            onClick={togglePiP}
            title="Picture-in-picture"
            className="rounded-full bg-black/60 px-2.5 py-1.5 text-xs text-white hover:bg-black/80 active:bg-black/80"
          >
            {isPiP ? "Sair do PIP" : "PIP"}
          </button>
        )}
        <button
          type="button"
          onClick={toggleFullscreen}
          title="Tela cheia"
          className="rounded-full bg-black/60 px-2.5 py-1.5 text-xs text-white hover:bg-black/80 active:bg-black/80"
        >
          {isFullscreen ? "Sair da tela cheia" : "Tela cheia"}
        </button>
      </div>
    </div>
  );
}
