"use client";

// Every effect here is synthesized with the Web Audio API instead of
// shipped as audio files — keeps this asset-free and avoids having to pick
// (and clear the rights to) actual sound files. A shared, lazily-created
// AudioContext is reused across calls; browsers start it suspended until a
// user gesture happens elsewhere on the page, which by the time anyone's in
// a room already occurred (joining requires typing a name and submitting).
let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioContextCtor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return null;
  if (!audioCtx) audioCtx = new AudioContextCtor();
  if (audioCtx.state === "suspended") void audioCtx.resume();
  return audioCtx;
}

type Note = {
  freq: number;
  start: number;
  duration: number;
  gain?: number;
  type?: OscillatorType;
};

// Each note gets its own oscillator + gain envelope (quick linear attack,
// exponential decay) so notes sound like soft chimes instead of harsh
// on/off clicks.
function playNotes(notes: Note[]) {
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  for (const note of notes) {
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();
    osc.type = note.type ?? "sine";
    osc.frequency.value = note.freq;
    const startAt = now + note.start;
    const endAt = startAt + note.duration;
    const peakGain = note.gain ?? 0.15;
    gainNode.gain.setValueAtTime(0, startAt);
    gainNode.gain.linearRampToValueAtTime(peakGain, startAt + 0.015);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, endAt);
    osc.connect(gainNode);
    gainNode.connect(ctx.destination);
    osc.start(startAt);
    osc.stop(endAt + 0.02);
  }
}

export function playJoinSound() {
  playNotes([
    { freq: 587, start: 0, duration: 0.12 },
    { freq: 880, start: 0.09, duration: 0.16 },
  ]);
}

export function playLeaveSound() {
  playNotes([
    { freq: 660, start: 0, duration: 0.12 },
    { freq: 415, start: 0.09, duration: 0.18 },
  ]);
}

export function playShareStartSound() {
  playNotes([
    { freq: 523, start: 0, duration: 0.09 },
    { freq: 659, start: 0.07, duration: 0.09 },
    { freq: 784, start: 0.14, duration: 0.18 },
  ]);
}

export function playShareStopSound() {
  playNotes([{ freq: 392, start: 0, duration: 0.18, type: "triangle" }]);
}

export function playMentionSound() {
  playNotes([
    { freq: 988, start: 0, duration: 0.1, gain: 0.18 },
    { freq: 988, start: 0.14, duration: 0.14, gain: 0.18 },
  ]);
}

// Used for site-wide "top" warnings/announcements (see AnnouncementBanner).
export function playWarningSound() {
  playNotes([
    { freq: 784, start: 0, duration: 0.1, type: "square", gain: 0.1 },
    { freq: 784, start: 0.14, duration: 0.1, type: "square", gain: 0.1 },
    { freq: 784, start: 0.28, duration: 0.16, type: "square", gain: 0.1 },
  ]);
}
