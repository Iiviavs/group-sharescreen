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

import { app, dialog, type BrowserWindow } from "electron";
import { autoUpdater } from "electron-updater";

// First check is delayed rather than immediate: launch is already busy
// creating the window and loading the site, and an update that lands four
// minutes late costs nobody anything.
const FIRST_CHECK_DELAY_MS = 45_000;
// Long-running sessions are the norm for this app — a call left open all
// afternoon — so re-checking matters, but rarely.
const CHECK_INTERVAL_MS = 6 * 60 * 60_000;

let promptOpen = false;

export function initAutoUpdater(getWindow: () => BrowserWindow | null) {
  // In development there is no packaged app to replace and no `app-update.yml`
  // for the updater to read, so it would only ever log an error. Bailing out
  // keeps `npm run electron:dev` quiet.
  if (!app.isPackaged) return;

  // Download in the background as soon as one is found. The install itself
  // still waits for a deliberate moment — see below.
  autoUpdater.autoDownload = true;
  // If the prompt below is dismissed, the update is applied the next time
  // the app closes on its own. That is the whole safety net: someone who
  // never says yes still ends up current, without anything interrupting
  // them mid-call.
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-downloaded", async (info) => {
    // The event can fire more than once across a long session; a second
    // dialog stacked on the first would be worse than no dialog.
    if (promptOpen) return;
    promptOpen = true;
    const window = getWindow();
    const options = {
      type: "info" as const,
      buttons: ["Reiniciar agora", "Depois"],
      defaultId: 0,
      cancelId: 1,
      title: "Atualização disponível",
      message: `A versão ${info.version} do GoLive está pronta.`,
      detail:
        "Ela será instalada automaticamente quando você fechar o aplicativo — ou reinicie agora para usar já.",
    };
    const { response } = window
      ? await dialog.showMessageBox(window, options)
      : await dialog.showMessageBox(options);
    promptOpen = false;
    // "Depois" is a real answer, not a postponement to nag about: autoInstall
    // OnAppQuit above already guarantees they get it.
    if (response === 0) {
      // isSilent=true, isForceRunAfter=true — reinstall without a wizard and
      // come straight back, since the user asked for this *now* and being
      // dropped back to the desktop is not what they meant.
      autoUpdater.quitAndInstall(true, true);
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
