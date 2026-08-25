// System audio capture that excludes GoLive's own output.
//
// The problem this solves
// -----------------------
// A screen share with system audio captures the whole render mix — which
// includes what GoLive itself is playing: every participant's voice, and the
// audio of every screen share being watched. Those go straight back out to
// the room, so everyone hears themselves a beat late. That is the echo.
//
// Electron's own `audio: "loopback"` cannot help, because it captures the
// endpoint mix with no way to leave a process out of it, and Chromium
// exposes no process-loopback device id to ask for one. So the capture is
// done here instead, by a small native helper (electron/native) that uses
// the WASAPI process-loopback API to capture everything *except* our own
// process tree — which covers Chromium's audio service, a child utility
// process, and therefore everything the app plays.
//
// The trade this makes deliberately: GoLive's *other* sounds — the join and
// leave chimes, an embedded YouTube/Twitch tile — are excluded too, since
// nothing distinguishes them from the participants' audio at the process
// level. That is the right outcome anyway. Everyone in the room already
// hears those locally, so putting them in the stream would double them.
//
// Everything here is Windows-only and degrades to nothing everywhere else;
// see isSystemAudioExclusionSupported.

import { app } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import type { WebContents } from "electron";
import { IPC, SYSTEM_AUDIO_FORMAT } from "./channels";

// Whether this Windows can do process loopback is decided by *asking it*,
// not by comparing build numbers.
//
// The temptation is a check against 20348, the build Microsoft's docs name.
// It would be wrong. 20348 is Server 2022, so the check reads as "Windows 11
// or later" and would exclude every Windows 10 machine — but the API is
// reported working on Windows 10 22H2, where the only thing that actually
// fails is GetMixFormat/IsFormatSupported returning E_NOTIMPL
// (microsoft/Windows-classic-samples#343). The helper calls neither: process
// loopback is not tied to an endpoint, so it states its format instead of
// negotiating one.
//
// So the helper is launched and answers for itself — it prints READY when
// the capture is running, and exits with a distinct code when activation is
// refused. A version gate here could only ever be a guess at that answer,
// and guessing high silently disables the feature on machines that support
// it while guessing low breaks the share on machines that do not.
const READY_LINE = "READY";

// How long to wait for that line before giving up. Generous: this covers a
// process start and one COM activation, both of which are fast, but a cold
// page-in of the executable on a busy machine is not.
const READY_TIMEOUT_MS = 5000;

// Remembers a refusal, so a machine that cannot do this pays for one spawn
// per session rather than one per share. Never set from an ordinary failure
// — only from the helper explicitly reporting the API unavailable.
let knownUnsupported = false;

// The helper's own exit code for "activation refused". Mirrors
// EXIT_UNSUPPORTED in native/src/audiocap.cpp.
const EXIT_UNSUPPORTED = 3;

// How much audio to accumulate before handing a chunk to the renderer.
// WASAPI delivers ~10 ms packets; forwarding each one individually would be
// 100 IPC messages a second for no benefit, while batching much further
// would start to matter for latency. 20 ms is the same period Opus encodes
// at anyway.
const CHUNK_MS = 20;
const CHUNK_BYTES =
  (SYSTEM_AUDIO_FORMAT.sampleRate / 1000) *
  CHUNK_MS *
  SYSTEM_AUDIO_FORMAT.channels *
  (SYSTEM_AUDIO_FORMAT.bitsPerSample / 8);

// Where the helper lives, which differs between a checkout and an installed
// app. Packaged it is copied verbatim into resources/ (see
// electron-builder.yml's extraResources) rather than into app.asar, because
// a process inside an asar archive cannot be executed — the archive is not a
// real directory to the OS.
function helperPath(): string {
  const name = "golive-audiocap.exe";
  return app.isPackaged
    ? path.join(process.resourcesPath, name)
    : path.join(__dirname, "..", "native", "bin", name);
}

/**
 * Whether it is worth *trying* to capture system audio with GoLive left out
 * of it — this machine is Windows and the helper shipped with the build.
 *
 * Deliberately not the same question as "will it work": that one is only
 * answered by running the helper (see READY_LINE above), and the answer
 * arrives too late for the preload, which has to decide at window-creation
 * time whether to expose the bridge at all. Being optimistic here is the
 * right way round — `start()` still reports a refusal honestly, and the web
 * app treats that exactly like an absent bridge.
 */
export function isSystemAudioExclusionSupported(): boolean {
  if (process.platform !== "win32") return false;
  if (knownUnsupported) return false;
  // A build made on a machine without the C++ toolchain simply has no
  // binary — see electron/native/build.mjs, which warns and carries on.
  return existsSync(helperPath());
}

let child: ChildProcessWithoutNullStreams | null = null;
let target: WebContents | null = null;
let detachTarget: (() => void) | null = null;

/** Whether a capture is running right now. */
export function isSystemAudioCapturing(): boolean {
  return child !== null;
}

/**
 * Starts the capture and streams PCM to `webContents`.
 *
 * Resolves false when the capture could not be started — including when this
 * Windows turns out not to support process loopback at all, which is only
 * discoverable by trying. The renderer asks for this *before* calling
 * getDisplayMedia precisely so that answer still leaves time to fall back to
 * an ordinary loopback share.
 *
 * It resolves once the helper reports the capture running, rather than once
 * the process exists: a spawn that succeeds and then fails activation a few
 * milliseconds later would otherwise be reported as success, and the share
 * would come out silent instead of falling back.
 */
export function startSystemAudioCapture(webContents: WebContents): Promise<boolean> {
  if (!isSystemAudioExclusionSupported()) return Promise.resolve(false);
  // A second share while one is running would otherwise leave the first
  // helper orphaned, writing into a pipe nobody reads.
  stopSystemAudioCapture();

  let spawned: ChildProcessWithoutNullStreams;
  try {
    spawned = spawn(helperPath(), ["--exclude-pid", String(process.pid)], {
      // No console flash. The helper is a console subsystem binary because
      // it writes PCM to stdout, and without this Windows gives it a window.
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    return Promise.resolve(false);
  }

  child = spawned;
  target = webContents;

  // Settled by the first of: the helper reporting READY, the helper exiting,
  // or the timeout. Whichever wins, the others become no-ops.
  let settle: (ready: boolean) => void;
  const ready = new Promise<boolean>((resolve) => {
    let done = false;
    settle = (value: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      // A helper that is alive but never said READY is wedged, not working.
      // Left running it would hold an audio client open for the session.
      if (!value) stopSystemAudioCapture();
      resolve(value);
    };
    const timer = setTimeout(() => settle(false), READY_TIMEOUT_MS);
    timer.unref?.();
  });

  // Partial packets accumulate here until there is a full chunk. Sending
  // ragged sizes would work — the worklet on the other side handles any
  // length — but a steady cadence keeps its jitter buffer predictable.
  let pending: Buffer[] = [];
  let pendingBytes = 0;

  spawned.stdout.on("data", (data: Buffer) => {
    pending.push(data);
    pendingBytes += data.length;
    if (pendingBytes < CHUNK_BYTES) return;
    const joined = Buffer.concat(pending, pendingBytes);
    // Whole chunks go out; the remainder starts the next batch. Slicing on a
    // frame boundary is what keeps the stereo pairs aligned — half a frame
    // in the wrong place swaps the channels for the rest of the session.
    const sendable = joined.length - (joined.length % CHUNK_BYTES);
    const rest = joined.subarray(sendable);
    pending = rest.length > 0 ? [Buffer.from(rest)] : [];
    pendingBytes = rest.length;
    if (target && !target.isDestroyed()) {
      target.send(IPC.systemAudioData, joined.subarray(0, sendable));
    }
  });

  // stderr carries both the readiness signal and the diagnostics. The
  // diagnostics — an activation failure and its HRESULT — are the only clue
  // when this does not work, so they are forwarded rather than swallowed.
  spawned.stderr.on("data", (data: Buffer) => {
    const text = data.toString();
    if (text.includes(READY_LINE)) {
      settle(true);
      return;
    }
    process.stderr.write(`[audiocap] ${text}`);
  });

  const finish = (code?: number | null) => {
    // An exit before READY is this machine's answer to "is process loopback
    // available here". Remembered so the rest of the session stops paying a
    // spawn to be told the same thing again — but only for that one exit
    // code, never for a crash, which may well be transient.
    if (code === EXIT_UNSUPPORTED) knownUnsupported = true;
    settle(false);
    if (child !== spawned) return;
    const wc = target;
    cleanup();
    // Tells the renderer to stop waiting for audio that is not coming, so
    // the share can carry on silently instead of holding a dead track.
    if (wc && !wc.isDestroyed()) wc.send(IPC.systemAudioEnded);
  };
  spawned.on("error", () => finish());
  spawned.on("exit", (code) => finish(code));

  // A reload or a navigation replaces the page that asked for this, and its
  // MediaStream goes with it — without this the helper would keep capturing
  // into a renderer that has forgotten it exists. The site reloads on every
  // navigation (it is remote content, not an SPA shell), so this is a
  // routine event rather than an edge case.
  const onGone = () => stopSystemAudioCapture();
  // The details object, not the deprecated positional arguments that still
  // follow it — those are typed as optional, so reading isMainFrame out of
  // the second parameter type-checks and is then always undefined at
  // runtime, which would silently turn this listener into a no-op.
  //
  // isSameDocument excluded because a fragment change or a history.pushState
  // does not tear the page down, and stopping a live share for one would be
  // a bug of its own.
  const onNavigate = (details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>) => {
    if (details.isMainFrame && !details.isSameDocument) stopSystemAudioCapture();
  };
  webContents.once("destroyed", onGone);
  webContents.on("render-process-gone", onGone);
  webContents.on("did-start-navigation", onNavigate);
  detachTarget = () => {
    if (webContents.isDestroyed()) return;
    webContents.off("destroyed", onGone);
    webContents.off("render-process-gone", onGone);
    webContents.off("did-start-navigation", onNavigate);
  };

  return ready;
}

function cleanup() {
  detachTarget?.();
  detachTarget = null;
  child = null;
  target = null;
}

/** Stops the capture. Safe to call when nothing is running. */
export function stopSystemAudioCapture() {
  const running = child;
  if (!running) return;
  cleanup();
  // Closing stdin is the helper's documented shutdown signal (see its
  // WatchStdin): it stops the audio client properly and exits on its own.
  // kill() is the backstop for a helper that is already wedged, not the
  // first resort — terminating it outright leaves WASAPI to clean up after
  // the fact.
  try {
    running.stdin.end();
  } catch {
    // Already closed — the exit handler has this covered.
  }
  const forceKill = setTimeout(() => {
    if (!running.killed) running.kill();
  }, 1000);
  // Node keeps the process alive for a pending timer, and a one-second delay
  // on quit is a visible hang.
  forceKill.unref?.();
  running.once("exit", () => clearTimeout(forceKill));
}
