// The only thing the website is allowed to see of the desktop shell.
//
// Nothing here forwards a raw ipcRenderer handle: each function is a named,
// argument-checked operation, so the surface the remote page can reach is
// exactly this file and not "IPC in general". That distinction is the whole
// reason contextIsolation exists — a bridge that exposes `ipcRenderer` has
// contextIsolation switched on and none of its benefit.
//
// The shape mirrors DesktopBridge in lib/desktop.ts, which is where the
// website's side of this contract is typed.

import { contextBridge, ipcRenderer } from "electron";
import { IPC, VERSION_ARG } from "./channels";

// A sandboxed preload cannot reach `app.getVersion()` — it has no main-process
// APIs at all — and `process.env` set in main is not propagated here either.
// `additionalArguments` (see main.ts's webPreferences) is the documented way
// to get a value across that boundary, and it arrives in argv.
function readVersion(): string {
  const arg = process.argv.find((a) => a.startsWith(VERSION_ARG));
  return arg ? arg.slice(VERSION_ARG.length) : "0.0.0";
}

contextBridge.exposeInMainWorld("golive", {
  appVersion: readVersion(),
  platform: process.platform,

  startOAuth(startUrl: unknown, nonce: unknown): Promise<string | null> {
    if (typeof startUrl !== "string" || typeof nonce !== "string") {
      return Promise.resolve(null);
    }
    return ipcRenderer.invoke(IPC.oauthStart, startUrl, nonce);
  },

  cancelOAuth(nonce: unknown): void {
    if (typeof nonce === "string") ipcRenderer.send(IPC.oauthCancel, nonce);
  },

  openExternal(url: unknown): Promise<void> {
    if (typeof url !== "string") return Promise.resolve();
    return ipcRenderer.invoke(IPC.openExternal, url);
  },
});
