# golive-audiocap

A ~15 KB Win32 executable that captures the system audio mix **with GoLive
left out of it**, and writes it to stdout as raw PCM.

## Why it exists

Share your screen "with system audio" and the capture includes everything the
machine is playing — which includes GoLive: every other participant's voice,
and the audio of any share you are watching. All of it goes straight back out
to the room, so everyone hears themselves a beat late.

Windows can capture the mix minus one process tree
([`AUDIOCLIENT_ACTIVATION_PARAMS`][params] with
`PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE`), which is exactly the
shape of this problem. Nothing in Chromium or Electron exposes it: Electron's
`audio: "loopback"` captures the endpoint mix with no exclusion, and there is
no process-loopback device id to ask for instead. Hence this.

The excluded target is Electron's **main** process id, and "process tree"
covers its children. That matters more than it looks: Chromium does not render
audio in the renderer, it renders it in the audio service — a child utility
process — so excluding the renderer alone would exclude nothing at all.

## What that trades away

Everything GoLive plays is excluded, not just the participants: the join and
leave chimes, an embedded YouTube/Twitch tile. Nothing distinguishes them at
the process level.

That is the right outcome anyway. Every one of those is already playing
locally for everyone in the room, so putting them in the stream would double
them rather than add them.

## Which Windows this works on

Decided at runtime, not from a build number — and that is worth explaining,
because the obvious check is wrong.

Microsoft documents process loopback as requiring **build 20348**. That number
reads as "Windows 11 only", since consumer Windows 10 stops at 19045 (22H2).
But 20348 is *Server 2022*, and the sample is reported working on Windows 10
22H2 all the same: what actually fails there is `GetMixFormat()` and
`IsFormatSupported()`, which return `E_NOTIMPL`
([Windows-classic-samples#343][issue343]).

This tool calls neither. Process loopback is not tied to an audio endpoint, so
it *states* its format rather than negotiating one — which means the one
documented Windows 10 failure is not on its path.

So support is answered by trying it: the helper prints `READY` on stderr once
the capture is actually running, and exits `3` when activation is refused.
`electron/systemAudio.ts` waits for one or the other before the share commits
to this path. A version gate would only have been a guess at that answer, and
guessing high disables the feature on machines that run it perfectly well.

## You almost certainly do not need to build this

`bin/golive-audiocap.exe` is **committed to the repository**, built by
[`.github/workflows/build-audiocap.yml`][wf] whenever `audiocap.cpp` changes.
A clone has a current binary already, so `npm run electron:dev` and
`electron-builder` work with no compiler installed — on Windows, macOS or
Linux. Users installing the app never compile anything either; the .exe ships
inside the installer via `extraResources`.

`bin/golive-audiocap.exe.sha256` holds the hash of the `audiocap.cpp` the
binary was built from. `build.mjs` checks it on every build, which is what
makes a committed binary trustworthy: a stale one is reported rather than
silently used, and anyone can tell whether the .exe matches the .cpp beside
it. It is a content hash and not a timestamp because git does not preserve
mtimes — in a fresh clone every file is stamped at checkout time, so
comparing dates would decide "is this stale" by coin flip.

So the only reason to build locally is to change `audiocap.cpp` itself. Edit
it, push, and CI recompiles and commits the result; the warning you get
meanwhile tells you the binary predates your edit.

## Your editor will show this file as full of errors

Expected, on any machine without a Windows SDK — which is most of them, and
all of the macOS and Linux ones. IntelliSense cannot find `audioclient.h` or
`audioclientactivationparams.h`, so every COM type in the file is unknown and
the errors cascade into the hundreds. A C/C++ extension configured for MinGW
or clang adds to it: `__uuidof`, `STDMETHODIMP` and `__declspec(uuid)` are
MSVC extensions this file uses deliberately.

None of that says anything about whether it compiles. The build runs `cl.exe`
against the real SDK in CI, and that is the only opinion that counts. There is
no editor configuration that fixes this without installing the SDK — the
headers genuinely are not on the machine — so the choice is to install it (see
below, it is the same install that lets you build locally) or to ignore the
squiggles.

## Building it anyway

```bash
npm run electron:native                     # part of electron:build too
node electron/native/build.mjs --force      # rebuild even if the hash matches
node electron/native/build.mjs --required   # exit 1 instead of warning (CI)
```

Needs the **"Desktop development with C++"** workload from Visual Studio (the
free Build Tools are enough), which supplies `cl.exe` and the Windows SDK.
`build.mjs` finds it with `vswhere` and shells out to `VsDevCmd.bat`.

Without that toolchain the build **warns and carries on**, using the committed
binary. `--required` turns the warning into a failure, and is what the release
workflow uses — that one also passes `--force`, so what ships to users is
compiled from the tagged source rather than taken on trust from git.

There is no node-gyp here and no Node addon. That is deliberate: an addon is
bound to an Electron ABI, so every Electron bump would need a rebuild and a
matching prebuild per architecture, and a mismatch is a hard crash at load
time — in an app that auto-updates its own shell. A plain executable has no
ABI to match. It also isolates a real-time audio thread, and a crash, away
from the process running the call. See the header comment in
`src/audiocap.cpp`.

## Interface

```
golive-audiocap.exe --exclude-pid <pid>

  stdout   raw PCM, 48 kHz, stereo, interleaved little-endian signed 16-bit
  stderr   "READY" once capturing; otherwise diagnostics (an activation HRESULT)
  stdin    closing it is the shutdown signal
  exit 3   process loopback unavailable or refused — caller should fall back
```

The format is fixed rather than negotiated because process loopback is not
tied to an audio endpoint: the capture asks the audio engine for a format and
gets it, instead of accepting whatever a device's mix format happens to be.
It is declared once in `electron/channels.ts` as `SYSTEM_AUDIO_FORMAT` and
mirrored here and in `public/worklets/system-audio.js`.

## The rest of the path

| Where                             | What it does                                              |
| --------------------------------- | --------------------------------------------------------- |
| `src/audiocap.cpp`                | This. WASAPI process loopback → stdout                     |
| `electron/systemAudio.ts`         | Spawns it, batches stdout into 20 ms chunks, forwards them |
| `electron/main.ts`                | Withholds Electron's loopback track while it runs          |
| `electron/preload.ts`             | `window.golive.systemAudio`, exposed only where supported  |
| `lib/desktopSystemAudio.ts`       | PCM → `MediaStreamTrack`                                   |
| `public/worklets/system-audio.js` | Jitter buffer and clock-drift correction                   |
| `lib/useRoomMedia.ts`             | Starts it before `getDisplayMedia`, adds the track after   |

Derived from Microsoft's [ApplicationLoopback sample][sample].

[wf]: ../../.github/workflows/build-audiocap.yml
[issue343]: https://github.com/microsoft/Windows-classic-samples/issues/343
[params]: https://learn.microsoft.com/en-us/windows/win32/api/audioclientactivationparams/ns-audioclientactivationparams-audioclient_activation_params
[sample]: https://learn.microsoft.com/en-us/samples/microsoft/windows-classic-samples/applicationloopbackaudio-sample/
