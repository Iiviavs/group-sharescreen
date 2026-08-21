"use client";

// Type-only: erased at compile time, so this doesn't pull the runtime module
// (and its `class ... extends AudioWorkletNode` at module scope, see below)
// into the server bundle.
import type { RnnoiseWorkletNode, loadRnnoise as LoadRnnoiseFn } from "@sapphi-red/web-noise-suppressor";

// Static assets copied from node_modules/@sapphi-red/web-noise-suppressor/dist
// into public/rnnoise — served as plain files so this works regardless of
// bundler (the package's own docs assume Vite's `?url` imports, which Next.js
// doesn't support).
const WORKLET_URL = "/rnnoise/workletProcessor.js";
const WASM_URL = "/rnnoise/rnnoise.wasm";
const WASM_SIMD_URL = "/rnnoise/rnnoise_simd.wasm";

// The wasm binary never changes at runtime, so it's fetched once and reused
// across every mic start in this tab instead of re-downloading it each time.
let wasmBinaryPromise: Promise<ArrayBuffer> | null = null;

function getRnnoiseWasmBinary(loadRnnoise: typeof LoadRnnoiseFn): Promise<ArrayBuffer> {
  if (!wasmBinaryPromise) {
    wasmBinaryPromise = loadRnnoise({ url: WASM_URL, simdUrl: WASM_SIMD_URL }).catch((err: unknown) => {
      // Let a later mic start try again instead of permanently remembering
      // this one failure (e.g. a transient network blip on first load).
      wasmBinaryPromise = null;
      throw err;
    });
  }
  return wasmBinaryPromise;
}

export type MicNoiseGraph = {
  rawStream: MediaStream;
  audioCtx: AudioContext;
  source: MediaStreamAudioSourceNode;
  rnnoiseNode: RnnoiseWorkletNode;
  destination: MediaStreamAudioDestinationNode;
};

export type MicCaptureResult = {
  // What actually gets broadcast over WebRTC — either the RNNoise-processed
  // output, or (if setup failed) the raw capture, unprocessed.
  stream: MediaStream;
  // Null when RNNoise couldn't be set up (unsupported browser, blocked
  // fetch, etc.) — the caller uses this to grey out the suppression toggle.
  graph: MicNoiseGraph | null;
};

// Captures the mic and routes it through an RNNoise AudioWorklet before
// returning it, so background noise is suppressed for everyone else in the
// room. Falls back to the raw, unprocessed capture if RNNoise can't be set
// up — a noisy call still beats no call at all.
export async function captureNoiseSuppressedMic(
  suppressionEnabled: boolean,
  onGraphEnded?: () => void,
  // Null/undefined captures the system default input, same as before this
  // param existed.
  deviceId?: string | null
): Promise<MicCaptureResult> {
  const rawStream = await navigator.mediaDevices.getUserMedia({
    audio: deviceId ? { deviceId: { exact: deviceId } } : true,
  });

  if (typeof window === "undefined" || typeof AudioWorkletNode === "undefined") {
    return { stream: rawStream, graph: null };
  }

  try {
    // Dynamic: this package's classes do `extends AudioWorkletNode` at
    // module scope, which throws a bare ReferenceError if evaluated on the
    // server (React SSR still executes "use client" modules' static imports
    // on the server for the initial render). Importing it here, after the
    // AudioWorkletNode guard above, means it only ever loads in the browser.
    const { RnnoiseWorkletNode, loadRnnoise } = await import("@sapphi-red/web-noise-suppressor");
    const audioCtx = new AudioContext();
    await audioCtx.audioWorklet.addModule(WORKLET_URL);
    const wasmBinary = await getRnnoiseWasmBinary(loadRnnoise);

    const source = audioCtx.createMediaStreamSource(rawStream);
    const destination = audioCtx.createMediaStreamDestination();
    // RNNoise only ever processes mono; the mic capture above is mono too.
    const rnnoiseNode = new RnnoiseWorkletNode(audioCtx, { maxChannels: 1, wasmBinary });

    if (suppressionEnabled) {
      source.connect(rnnoiseNode);
      rnnoiseNode.connect(destination);
    } else {
      source.connect(destination);
    }

    // The destination's track is what's actually sent over WebRTC (see
    // useRoomMedia) — tying teardown to *its* "ended" event means cleanup
    // runs no matter what stops it (manual toggle-off, unmount, or the raw
    // track ending on its own), instead of every caller having to remember
    // to separately release the raw stream and AudioContext.
    const outputTrack = destination.stream.getAudioTracks()[0];
    outputTrack.addEventListener(
      "ended",
      () => {
        rawStream.getTracks().forEach((t) => t.stop());
        rnnoiseNode.destroy();
        audioCtx.close().catch(() => {});
        onGraphEnded?.();
      },
      { once: true }
    );

    return { stream: destination.stream, graph: { rawStream, audioCtx, source, rnnoiseNode, destination } };
  } catch {
    return { stream: rawStream, graph: null };
  }
}

// Reroutes the live audio graph between "through RNNoise" and "straight
// through" — toggling this never touches the broadcast track itself (it's
// always the destination node's track), so peers never see a renegotiation.
export function setGraphSuppressionEnabled(graph: MicNoiseGraph | null, enabled: boolean) {
  if (!graph) return;
  graph.source.disconnect();
  graph.rnnoiseNode.disconnect();
  if (enabled) {
    graph.source.connect(graph.rnnoiseNode);
    graph.rnnoiseNode.connect(graph.destination);
  } else {
    graph.source.connect(graph.destination);
  }
}
