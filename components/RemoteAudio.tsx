"use client";

import { useEffect, useRef } from "react";
import { useAudioBooster } from "@/lib/useAudioBooster";

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

  useAudioBooster(stream, volume, muted);

  // Keep an audio element with muted=true to prevent WebRTC from throttling/pausing the track
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.srcObject = stream;
      audioRef.current.muted = true;
    }
  }, [stream]);

  return <audio ref={audioRef} autoPlay playsInline muted className="sr-only" />;
}

