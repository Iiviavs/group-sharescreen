"use client";

import { useEffect, useRef } from "react";
import { useGainedAudio } from "@/lib/useGainedAudio";

export function RemoteAudio({
  stream,
  muted = false,
  volume = 1,
}: {
  stream: MediaStream;
  muted?: boolean;
  // Up to audioGain.ts's MAX_GAIN (300%) — see useGainedAudio.
  volume?: number;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (audioRef.current) audioRef.current.srcObject = stream;
  }, [stream]);

  useGainedAudio(audioRef, stream, volume, muted);

  return <audio ref={audioRef} autoPlay className="sr-only" />;
}
