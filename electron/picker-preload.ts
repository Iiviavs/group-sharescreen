// Bridge for the screen picker window (see picker.html).
//
// Separate from the main preload because it is handed to a different window
// with a different job: this one may read the source list, and nothing else.
// The main window's bridge deliberately has no access to it — the list
// contains the title of every open window on the machine, and the website
// loaded in that window has no business seeing them.

import { contextBridge, ipcRenderer } from "electron";
import { IPC, type PickerSource } from "./channels";

contextBridge.exposeInMainWorld("picker", {
  list(): Promise<PickerSource[]> {
    return ipcRenderer.invoke(IPC.pickerList);
  },
  choose(id: string | null): void {
    ipcRenderer.send(IPC.pickerChoose, id);
  },
});
