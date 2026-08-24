"use client";

import { useEffect, useRef, useState } from "react";
import { getSharedAudioContext, ensureSharedAudioContextRunning } from "./audioContext";

const SPEAKING_THRESHOLD = 0.02;
const HOLD_MS = 400;
const CHECK_INTERVAL_MS = 150;

// Simple RMS-based voice activity detection over a MediaStream's audio
// track, with a short hold so brief pauses between syllables don't make the
// "speaking" indicator flicker.
export function useSpeaking(stream: MediaStream | null | undefined): boolean {
  const [speaking, setSpeaking] = useState(false);
  const lastAboveThresholdAt = useRef(0);

  useEffect(() => {
    // No setState here for the disabled case: speaking already defaults to
    // false, and the cleanup below resets it when a previous real stream
    // goes away, so nothing else needs to force it synchronously.
    if (!stream || stream.getAudioTracks().length === 0) {
      return;
    }

    // The app-wide context, not one of its own. This used to build a whole
    // AudioContext per participant, which in a call of six or more hit
    // Chrome's cap on concurrent contexts — and past that cap the
    // constructor *throws*, so the next thing to ask for a context (the
    // playback gain graph, the mic's noise suppression) couldn't get one
    // either. An analyser is a node; it never needed a context of its own.
    const audioContext = getSharedAudioContext();
    if (!audioContext) return;
    void ensureSharedAudioContextRunning();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.6;
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);

    const interval = setInterval(() => {
      analyser.getByteTimeDomainData(data);
      let sumSquares = 0;
      for (let i = 0; i < data.length; i += 1) {
        const normalized = (data[i] - 128) / 128;
        sumSquares += normalized * normalized;
      }
      const rms = Math.sqrt(sumSquares / data.length);
      const now = Date.now();
      if (rms > SPEAKING_THRESHOLD) {
        lastAboveThresholdAt.current = now;
        setSpeaking(true);
      } else if (now - lastAboveThresholdAt.current > HOLD_MS) {
        setSpeaking(false);
      }
    }, CHECK_INTERVAL_MS);

    return () => {
      clearInterval(interval);
      source.disconnect();
      analyser.disconnect();
      // Never closed here: it's shared now, and closing it would silence
      // every other stream on the page along with this analyser.
      setSpeaking(false);
    };
  }, [stream]);

  return speaking;
}
