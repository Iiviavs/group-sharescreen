"use client";

import { useEffect, useRef } from "react";

export function RemoteAudio({
  stream,
  muted = false,
  volume = 1,
}: {
  stream: MediaStream;
  muted?: boolean;
  volume?: number;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (audioRef.current) audioRef.current.srcObject = stream;
  }, [stream]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = muted;
    audio.volume = Math.min(1, Math.max(0, volume));
  }, [muted, volume]);

  return <audio ref={audioRef} autoPlay className="sr-only" />;
}
