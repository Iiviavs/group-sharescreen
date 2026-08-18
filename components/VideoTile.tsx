"use client";

import { useEffect, useRef, useState } from "react";

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
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isMuted, setIsMuted] = useState(muted);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = isMuted;
  }, [isMuted]);

  return (
    <div className="group relative aspect-video overflow-hidden rounded-xl border border-white/10 bg-black">
      <video ref={videoRef} autoPlay playsInline className="h-full w-full object-contain bg-black" />
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/85 to-transparent px-3 py-2">
        <span className="truncate text-sm font-medium text-white">{label}</span>
        {badge && (
          <span className="rounded-full bg-red-500/90 px-2 py-0.5 text-xs font-semibold text-white">
            {badge}
          </span>
        )}
      </div>
      {allowUnmute && (
        <button
          type="button"
          onClick={() => setIsMuted((m) => !m)}
          className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-1 text-xs text-white opacity-0 transition hover:bg-black/80 group-hover:opacity-100"
        >
          {isMuted ? "Ativar som" : "Silenciar"}
        </button>
      )}
    </div>
  );
}
