// Keeps the *shell* current.
//
// Worth being precise about what this does and does not cover, because the
// wrapper architecture splits it in two:
//
//   - The website — every screen, all the WebRTC, the mesh/cascade — is
//     loaded live from golive.nemtudo.me, so a deploy reaches users on their
//     next launch with nothing to install and nothing here involved.
//   - This file covers the other half: main.ts, the preloads, the picker.
//     That code ships inside the executable, so changing it means a new
//     installer, and without an updater users would sit on whatever build
//     they first downloaded forever.
//
// Feed comes from the same GitHub release the /download route reads (see
// electron-builder.yml's publish block) — electron-builder writes the
// `latest.yml` manifest alongside the installers, which is what
// electron-updater polls.

import { app, ipcMain, BrowserWindow } from "electron";
import { autoUpdater } from "electron-updater";
import { IPC } from "./channels";

// First check is delayed rather than immediate: launch is already busy
// creating the window and loading the site, and an update that lands four
// minutes late costs nobody anything.
const FIRST_CHECK_DELAY_MS = 45_000;
// Long-running sessions are the norm for this app — a call left open all
// afternoon — so re-checking matters, but rarely.
const CHECK_INTERVAL_MS = 6 * 60 * 60_000;

// The version sitting downloaded on disk, or null while there is nothing to
// apply. Kept here rather than only announced, because the announcement is
// unreliable by nature: the renderer is a remote website that reloads on
// every navigation, and the download typically lands long before or long
// after any given page exists. See IPC.updatePending.
let pendingVersion: string | null = null;

export function initAutoUpdater() {
  // Registered before the isPackaged bail-out below so the renderer's query
  // always gets a real answer. In dev that answer is null forever, which is
  // the truth — there is no packaged app to update — and is far better than
  // an invoke that rejects on a channel nobody handles.
  ipcMain.handle(IPC.updatePending, () => pendingVersion);
  ipcMain.on(IPC.updateInstall, () => {
    if (!pendingVersion) return;
    // isSilent=true, isForceRunAfter=true — reinstall without a wizard and
    // come straight back. The user pressed a button meaning "now", and being
    // dropped back to the desktop is not what they meant by it.
    autoUpdater.quitAndInstall(true, true);
  });

  // In development there is no packaged app to replace and no `app-update.yml`
  // for the updater to read, so it would only ever log an error. Bailing out
  // keeps `npm run electron:dev` quiet.
  if (!app.isPackaged) return;

  // Nothing here interrupts. Download in the background, tell the page it can
  // offer a button, install on quit regardless.
  //
  // There used to be a "Reiniciar agora / Depois" modal when the download
  // finished. It was removed deliberately — this app's sessions are calls,
  // and a dialog that steals focus mid-call is an interruption at the worst
  // possible moment to buy something the next restart hands over for free.
  // The green button the site now shows is the same offer with none of that:
  // it waits to be noticed instead of demanding an answer.
  autoUpdater.autoDownload = true;
  // The one line that makes the quiet safe: the downloaded update is applied
  // the next time the app closes on its own, so someone who never presses
  // the button still ends up current.
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-downloaded", (info) => {
    pendingVersion = info.version;
    // Every window, not just a "main" one: a room opened from a deep link
    // gets its own, and whichever one the user is looking at is the one that
    // has to show the button.
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(IPC.updateReady, info.version);
    }
  });

  autoUpdater.on("error", () => {
    // Offline, GitHub unreachable, a release without the right manifest — all
    // of it is invisible to the user on purpose. A failed update check is not
    // something they did or can fix, and the app works perfectly without one.
  });

  const check = () => {
    autoUpdater.checkForUpdates().catch(() => {
      // Same reasoning as the error handler; checkForUpdates rejects on the
      // same conditions and an unhandled rejection here would be noise.
    });
  };

  setTimeout(check, FIRST_CHECK_DELAY_MS);
  setInterval(check, CHECK_INTERVAL_MS);
}
