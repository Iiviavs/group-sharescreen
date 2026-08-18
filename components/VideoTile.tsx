"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

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
}: {
  stream: MediaStream;
  label: string;
  badge?: string;
  muted?: boolean;
  allowUnmute?: boolean;
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
      className="group relative aspect-video overflow-hidden rounded-xl border border-white/10 bg-black"
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
      <div className="absolute right-2 top-2 flex items-center gap-1.5 opacity-0 transition group-hover:opacity-100">
        {allowUnmute && (
          <button
            type="button"
            onClick={() => setIsMuted((m) => !m)}
            className="rounded-full bg-black/60 px-2 py-1 text-xs text-white hover:bg-black/80"
          >
            {isMuted ? "Ativar som" : "Silenciar"}
          </button>
        )}
        {pipSupported && (
          <button
            type="button"
            onClick={togglePiP}
            title="Picture-in-picture"
            className="rounded-full bg-black/60 px-2 py-1 text-xs text-white hover:bg-black/80"
          >
            {isPiP ? "Sair do PIP" : "PIP"}
          </button>
        )}
        <button
          type="button"
          onClick={toggleFullscreen}
          title="Tela cheia"
          className="rounded-full bg-black/60 px-2 py-1 text-xs text-white hover:bg-black/80"
        >
          {isFullscreen ? "Sair da tela cheia" : "Tela cheia"}
        </button>
      </div>
    </div>
  );
}
