"use client";

// Lets a stream's volume go above the native <audio>/<video> element
// ceiling of 1.0 (100%) by routing it through a Web Audio GainNode instead
// of the element's own `.volume`, which browsers hard-clamp to [0, 1]. One
// AudioContext shared by every remote stream in the app — an AudioContext
// per tile is unnecessary overhead, and browsers cap how many can exist
// anyway.

export const MAX_GAIN = 3;

let sharedContext: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (sharedContext) return sharedContext;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  sharedContext = new Ctor();
  return sharedContext;
}

export interface GainHandle {
  setGain(value: number): void;
  setMuted(value: boolean): void;
  dispose(): void;
}

/**
 * Attaches `stream`'s audio to the shared gain graph. Returns null when
 * Web Audio isn't available or the stream simply has no audio track — the
 * caller falls back to the element's own volume/muted in that case.
 *
 * The caller must silence its own <audio>/<video> element once this
 * succeeds (this graph is a second, independent path to the speakers; left
 * unmuted, the element would play its own unboosted copy alongside it).
 */
export function attachGain(
  stream: MediaStream,
  initialGain: number,
  initialMuted: boolean
): GainHandle | null {
  const ctx = getContext();
  if (!ctx || stream.getAudioTracks().length === 0) return null;
  // Some browsers start a newly-created context "suspended" until a user
  // gesture resumes it — by the time a remote stream arrives the room join
  // itself was already a gesture, but resuming defensively costs nothing.
  ctx.resume().catch(() => {});

  const source = ctx.createMediaStreamSource(stream);
  const gainNode = ctx.createGain();
  let gain = initialGain;
  let muted = initialMuted;
  const apply = () => {
    gainNode.gain.value = muted ? 0 : gain;
  };
  apply();
  source.connect(gainNode);
  gainNode.connect(ctx.destination);

  return {
    setGain(value: number) {
      gain = value;
      apply();
    },
    setMuted(value: boolean) {
      muted = value;
      apply();
    },
    dispose() {
      try {
        source.disconnect();
      } catch {
        // Already disconnected — nothing to do.
      }
      try {
        gainNode.disconnect();
      } catch {
        // As above.
      }
    },
  };
}
