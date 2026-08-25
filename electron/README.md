# GoLive desktop (Electron)

A **shell around the deployed site**, not a second copy of it. The window
loads `https://golive.nemtudo.me` and the entire UI — every component, all
the WebRTC, the whole mesh/cascade implementation — comes from there
unchanged.

That is deliberate. Bundling the Next build inside the app would buy nothing:
this is a real-time communication app, so it is useless without a network
connection anyway, and the site has server-side API routes (`/api/giphy`,
`/api/umami`) that a static export cannot serve. One deploy, one thing to keep
working, and a shipped app that never falls behind the website.

## What the shell actually adds

Three things, and everything in `main.ts` exists for one of them:

1. **A screen picker.** Electron does not implement `getDisplayMedia`'s own
   chooser. Without `setDisplayMediaRequestHandler` the app's single most
   important feature simply fails. The OS picker is preferred where it exists
   (`useSystemPicker`); `picker.html` is the fallback everywhere else.
2. **A working OAuth flow.** Providers refuse to authenticate inside an
   embedded browser — Google rejects it outright as `disallowed_useragent` —
   so login leaves for the real browser and comes back through a custom
   protocol. See below.
3. **The security posture remote content requires.** No Node in the renderer,
   no navigating away from our own origin, no in-app windows for third-party
   links.

## The OAuth handoff

The interesting part, because it spans three processes that cannot see each
other fail.

```
app: startOAuth(url, nonce)          returnTo = <origin>/desktop/oauth/<nonce>
  └─> shell.openExternal ──> system browser ──> provider ──> API
                                                             │
        API keeps only returnTo's *pathname* ────────────────┘
                                                             ▼
                       browser lands on <origin>/oauth/callback#…&next=/desktop/oauth/<nonce>
                                                             │
        callback page sees the marker path, no opener ───────┘
                                                             ▼
                              golive://oauth#<same fragment>  ──> app
                                                             │
        main matches the nonce against a login in flight ────┘
                                                             ▼
                              renderer's promise resolves with the fragment
```

Two details carry the design:

- **The marker lives in the path** because the API validates `returnTo`
  against an origin allowlist and keeps only the pathname, dropping query and
  hash. The path is the one part that survives the round trip — so this
  needed no API change at all.
- **The nonce is the security boundary.** Any program on the machine can
  register `golive://` and fire an unsolicited `#token=…` at us. Only a nonce
  naming a login currently in flight resolves anything. `lib/desktop.test.mts`
  pins that parser, rejections included.

The format is defined once in `lib/desktop.ts` and imported by both the
website and `main.ts`, rather than being a regex copied into two files.

## Layout

| File                | Role                                                            |
| ------------------- | --------------------------------------------------------------- |
| `main.ts`           | Window, screen picker, OAuth, deep links, navigation guards      |
| `preload.ts`        | The only surface the website sees (`window.golive`)              |
| `picker-preload.ts` | The picker window's bridge — separate, and deliberately narrower |
| `picker.html`       | Fallback screen/window chooser                                   |
| `channels.ts`       | IPC channel names, shared so a rename cannot desync the sides    |
| `build.mjs`         | esbuild bundling — see the note below                            |
| `build/icon.png`    | 512×512 source icon; electron-builder derives `.ico`/`.icns`     |

The icon is the site's own `public/icon.png` scaled to the 512×512
electron-builder needs to generate the platform formats. Replace
`build/icon.png` to change it — the `.ico`/`.icns` are generated, not
committed.

`picker-preload.ts` is separate from `preload.ts` for a reason: the source
list contains the **title of every open window** on the machine, and the
website loaded in the main window has no business seeing them before a choice
is made.

## Scripts

```bash
npm run electron:dev        # build + run against http://localhost:3000
npm run electron:start      # build + run against production
npm run electron:typecheck  # tsc over the shell (esbuild does not type-check)
npm run electron:pack       # unpacked build, for a quick look
npm run electron:dist       # real installers
```

## Two things that will bite you

**Sandboxed preloads cannot `require` relative modules.** A preload running
with `sandbox: true` gets a crippled `require` that resolves only `electron`
and a couple of builtins. `require("./channels")` throws at load time, the
preload never runs, and the bridge silently never appears — with no error in
the renderer. That is why `build.mjs` bundles each entrypoint with esbuild
instead of leaving `tsc` output as-is.

**electron-builder ignores `files` for `node_modules`.** It bundles every
production dependency regardless, so the `!node_modules/**/*` line in
`electron-builder.yml` is load-bearing: without it the installer ships all of
Next, React, sharp and their native binaries — 278 MB measured, versus 57 KB
for the shell.

## Updates — two halves, only one of which needs an installer

**The website updates itself.** Every screen, all the WebRTC, the whole
mesh/cascade implementation is loaded live from the deploy, so shipping a
front-end change reaches users on their next launch with nothing to install.
That is the wrapper architecture paying off, not a feature anyone had to
build.

The one caveat: a window left open for days keeps running the JavaScript it
loaded on launch, exactly like a browser tab nobody reloaded. `Ctrl/Cmd+R`
fixes it. Reloading automatically is deliberately *not* done — it would drop
a call in progress, which is a far worse outcome than slightly stale code.

**The shell needs an installer**, and that is what `updater.ts` handles:
`main.ts`, the preloads and the picker ship inside the executable. It polls
the same GitHub release the `/download` route reads, downloads in the
background, and then asks. Saying "Depois" is a real answer — the update
applies on the next ordinary quit either way, so nobody gets interrupted
mid-call and nobody is left behind.

Auto-update is inert in development (`app.isPackaged` is false), so
`electron:dev` never touches the network for it.

**Updates are differential, not whole-installer.** electron-builder ships a
`.blockmap` next to each build; the updater compares it against the installed
version and fetches only the changed blocks, falling back to a full download
when the old blockmap is missing or the diff is too large. This is also why
the macOS target builds a `zip` alongside the `dmg` — the dmg is what a
person downloads, the zip is what Squirrel.Mac can actually apply.

**A launch does not update before it runs.** Opening the app starts the
version already installed; the check happens shortly after, and the new
version takes effect on restart. The one case where a launch is already
current is when the previous session downloaded an update and quit — that is
`autoInstallOnAppQuit` doing its job.

> **macOS needs signing for this to work at all.** Squirrel.Mac refuses to
> apply an update to an unsigned bundle — silently. Windows and Linux update
> fine unsigned.

## Releasing

A commit does **not** release anything. Releasing is a tag, and the work
happens in CI:

```bash
npm version patch     # bumps package.json, commits, and creates a v… tag
git push --follow-tags
```

That tag triggers `.github/workflows/release-desktop.yml`, which builds on
macOS, Windows and Linux in parallel and uploads to a **draft** GitHub
release. Nothing is live yet — press **Publish release** on GitHub when all
three finish, and only then do `/download` and the updater start seeing it.

CI is not a nicety here: a macOS build can only be produced on macOS, so
without it the Mac version could never ship from a Windows machine at all.

To build locally without releasing — `npm run electron:dist` — you get
installers in `electron/release/` and no upload (there is no `GH_TOKEN`).

The macOS target is a **universal** binary on purpose: browsers on Apple
Silicon still report "Intel Mac OS X", so `/download` cannot tell the
architectures apart and one file that runs on both is the only honest answer.

## Before shipping

- **Signing.** Unsigned builds trip SmartScreen on Windows and Gatekeeper on
  macOS. Set `CSC_LINK` / `CSC_KEY_PASSWORD` in CI; macOS also needs
  notarisation (`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`).
- **Auto-update** is not wired. It needs a publish target and hosting, so it
  is a deployment decision rather than something to guess at here.

## Known platform limits

- **System audio** is Windows-only. Electron's loopback capture has no
  equivalent on macOS or Linux without a virtual audio device, and asking for
  it anyway fails the *whole* capture rather than just the audio — so the
  handler requests video alone there. The web app already degrades that way
  for Firefox, so nothing extra was needed on its side.
- **macOS screen recording** requires the user to grant permission in System
  Settings the first time, and the app must be restarted afterwards. That is
  the OS's behaviour, not something the shell can smooth over.
