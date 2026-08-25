// IPC channel names, shared between main and the two preloads.
//
// Kept in one file so a rename can never leave one side listening on a
// string the other stopped sending — an IPC channel is a stringly-typed
// contract and nothing else would catch the drift.

export const IPC = {
  /** renderer -> main: open an OAuth start URL in the system browser. */
  oauthStart: "golive:oauth:start",
  /** renderer -> main: give up on a pending login. */
  oauthCancel: "golive:oauth:cancel",
  /** renderer -> main: open an arbitrary URL in the default browser. */
  openExternal: "golive:open-external",
  /** main -> renderer: app metadata, resolved once at preload time. */
  appInfo: "golive:app-info",

  /** picker -> main: the sources to show. */
  pickerList: "golive:picker:list",
  /** picker -> main: the user's choice (a source id, or null to cancel). */
  pickerChoose: "golive:picker:choose",
} as const;

// Prefix of the argv entry main.ts injects via `additionalArguments` to hand
// the app version to the sandboxed preload — see preload.ts's readVersion.
export const VERSION_ARG = "--golive-version=";

/** What the picker window renders for each capturable surface. */
export interface PickerSource {
  id: string;
  name: string;
  /** PNG data URL of the live thumbnail. */
  thumbnail: string;
  /** Screens are listed before windows and labelled differently. */
  kind: "screen" | "window";
  /** App icon, when the OS provides one (windows only). */
  appIcon: string | null;
}
