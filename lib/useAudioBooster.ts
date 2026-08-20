"use client";

import { useEffect, useRef } from "react";

/**
 * Web Audio API booster hook that amplifies audio streams up to 200% (2.0 gain)
 * with dynamic peak compression to prevent audio clipping/distortion.
 */
export function useAudioBooster(
  stream: MediaStream | null | undefined,
  volume: number = 1,
  muted: boolean = false
) {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const volumeRef = useRef(volume);
  const mutedRef = useRef(muted);

  useEffect(() => {
    volumeRef.current = volume;
    mutedRef.current = muted;
  }, [volume, muted]);

  useEffect(() => {
    if (!stream || stream.getAudioTracks().length === 0) return;

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    audioCtxRef.current = ctx;

    let source: MediaStreamAudioSourceNode;
    try {
      source = ctx.createMediaStreamSource(stream);
      sourceNodeRef.current = source;
    } catch {
      ctx.close().catch(() => {});
      return;
    }

    const gainNode = ctx.createGain();
    const targetGain = mutedRef.current ? 0 : Math.max(0, Math.min(2, volumeRef.current));
    gainNode.gain.setValueAtTime(targetGain, ctx.currentTime);
    gainNodeRef.current = gainNode;

    // Dynamics compressor acts as a soft limiter to avoid digital clipping when boosted > 100%
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-20, ctx.currentTime);
    compressor.knee.setValueAtTime(25, ctx.currentTime);
    compressor.ratio.setValueAtTime(10, ctx.currentTime);
    compressor.attack.setValueAtTime(0.003, ctx.currentTime);
    compressor.release.setValueAtTime(0.25, ctx.currentTime);

    source.connect(gainNode);
    gainNode.connect(compressor);
    compressor.connect(ctx.destination);

    // Browser autoplay policy guard
    const resumeOnGesture = () => {
      if (ctx.state === "suspended") {
        ctx.resume();
      }
    };
    window.addEventListener("click", resumeOnGesture, { once: true });
    window.addEventListener("keydown", resumeOnGesture, { once: true });

    return () => {
      window.removeEventListener("click", resumeOnGesture);
      window.removeEventListener("keydown", resumeOnGesture);
      try {
        source.disconnect();
        gainNode.disconnect();
        compressor.disconnect();
        ctx.close().catch(() => {});
      } catch {
        // Ignored during unmount
      }
      audioCtxRef.current = null;
      gainNodeRef.current = null;
      sourceNodeRef.current = null;
    };
  }, [stream]);

  useEffect(() => {
    if (gainNodeRef.current && audioCtxRef.current) {
      const targetGain = muted ? 0 : Math.max(0, Math.min(2, volume));
      gainNodeRef.current.gain.setValueAtTime(targetGain, audioCtxRef.current.currentTime);
    }
  }, [muted, volume]);
}

