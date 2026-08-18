"use client";

import { useEffect, useRef } from "react";

export function RemoteAudio({ stream, muted = false }: { stream: MediaStream; muted?: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (audioRef.current) audioRef.current.srcObject = stream;
  }, [stream]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.muted = muted;
  }, [muted]);

  return <audio ref={audioRef} autoPlay className="sr-only" />;
}
