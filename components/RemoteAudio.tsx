"use client";

import { useEffect, useRef } from "react";

export function RemoteAudio({ stream }: { stream: MediaStream }) {
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (audioRef.current) audioRef.current.srcObject = stream;
  }, [stream]);

  return <audio ref={audioRef} autoPlay className="sr-only" />;
}
