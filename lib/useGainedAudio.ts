"use client";

import { useEffect, useRef, type RefObject } from "react";
import { attachGain, type GainHandle } from "./audioGain";

/**
 * Wires a <video>/<audio> element's audio through the shared Web Audio gain
 * graph (see audioGain.ts) instead of the element's own volume, so the dial
 * can go up to MAX_GAIN (300%) instead of being capped at 100%. Falls back
 * to the element's native volume/muted when Web Audio or an audio track
 * isn't available (attachGain returns null), so the element still behaves
 * correctly, just capped at 100% in that case.
 */
export function useGainedAudio<T extends HTMLMediaElement>(
  elementRef: RefObject<T | null>,
  stream: MediaStream | null | undefined,
  volume: number,
  muted: boolean
) {
  const gainRef = useRef<GainHandle | null>(null);

  // Only re-attaches when the stream itself changes — volume/muted below
  // update the existing graph in place instead of tearing it down, which
  // would otherwise pop/click on every slider drag.
  useEffect(() => {
    if (!stream) return;
    const handle = attachGain(stream, volume, muted);
    gainRef.current = handle;
    const el = elementRef.current;
    if (el) {
      if (handle) {
        el.muted = true; // audio now comes from the gain graph, not the element
      } else {
        el.muted = muted;
        el.volume = Math.min(1, Math.max(0, volume));
      }
    }
    return () => {
      handle?.dispose();
      if (gainRef.current === handle) gainRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream]);

  useEffect(() => {
    if (gainRef.current) gainRef.current.setGain(volume);
    else if (elementRef.current) elementRef.current.volume = Math.min(1, Math.max(0, volume));
  }, [volume, elementRef]);

  useEffect(() => {
    if (gainRef.current) gainRef.current.setMuted(muted);
    else if (elementRef.current) elementRef.current.muted = muted;
  }, [muted, elementRef]);
}
