"use client";

import { useEffect } from "react";

function isAndroid(): boolean {
  return typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
}

// Builds a short, valid, silent WAV file entirely in JS (rather than
// hand-rolling a base64 data URI, which is easy to get subtly wrong) and
// hands back a blob: URL an <audio> element can play. 8-bit mono at a low
// sample rate — it's silence, quality doesn't matter, and this keeps the
// blob tiny.
function createSilentWavUrl(): string {
  const sampleRate = 8000;
  const durationSeconds = 1;
  const dataSize = sampleRate * durationSeconds; // 1 byte per sample (8-bit)
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  function writeString(offset: number, text: string) {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  }

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true); // byte rate = sampleRate * channels * bytesPerSample
  view.setUint16(32, 1, true); // block align
  view.setUint16(34, 8, true); // bits per sample
  writeString(36, "data");
  view.setUint32(40, dataSize, true);
  // 8-bit unsigned PCM silence sits at the midpoint, not 0.
  for (let i = 0; i < dataSize; i++) view.setUint8(44 + i, 128);

  return URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
}

// Android (Chrome and most Chromium-based browsers there) suspends a
// backgrounded tab's JS — and drops its WebSocket/RTCPeerConnection with
// it — far sooner than one with an actively playing audio track, which
// instead gets a media-session notification and is treated closer to
// "still doing something the user cares about". This plays a silent,
// looping track for exactly that reason while a call is active, so
// switching apps or turning the screen off doesn't drop the room's
// connection as fast as it otherwise would. Volume is near-zero, not
// exactly zero — Chrome's "this tab is producing audio" detection (the
// thing that actually grants the relaxed background treatment) wants
// genuinely non-zero output, not just a technically-playing-but-silent
// track; 0.01 is inaudible in practice but still registers.
//
// No effect on iOS Safari, which suspends media-capturing tabs in the
// background regardless of any of this — an OS-level policy no web page
// can work around — so it's skipped there entirely rather than just
// draining battery for nothing. Not a guarantee on Android either: OEM
// battery-optimization layers (MIUI, One UI, etc.) can still kill a
// background tab outright. It only ever buys more time before that, on the
// platform where more time is actually possible to buy.
export function useBackgroundKeepAlive(active: boolean) {
  useEffect(() => {
    if (!active || !isAndroid()) return;
    const url = createSilentWavUrl();
    const audio = new Audio(url);
    audio.loop = true;
    audio.volume = 0.01;
    audio.play().catch(() => {
      // Blocked by the browser's autoplay policy — shouldn't happen here
      // since this only ever starts alongside an already-active call (a
      // user gesture already happened to get there), but if it does,
      // there's nothing to do beyond letting the tab background the same
      // as it always has.
    });
    return () => {
      audio.pause();
      URL.revokeObjectURL(url);
    };
  }, [active]);
}
