// The pure decisions behind the /download route: which platform a visitor is
// on, and which release asset belongs to it.
//
// Split out of the route handler so it can be tested directly — a route file
// may only export HTTP methods and segment config, so anything here would
// otherwise be unreachable from a test. And this is the half worth testing:
// getting it wrong hands someone an installer their machine cannot run,
// which is a worse failure than the download simply not working.

/** The three targets that are actually built — see electron-builder.yml. */
export type DownloadPlatform = "win" | "mac" | "linux";

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

// Which file belongs to which platform, by extension. Deliberately not a
// filename match: electron-builder puts the version (and sometimes the arch)
// in the name, so anything stricter would break on the next release.
const ASSET_PATTERN: Record<DownloadPlatform, RegExp> = {
  win: /\.exe$/i,
  mac: /\.dmg$/i,
  linux: /\.AppImage$/i,
};

/**
 * Best-effort platform detection from a user agent.
 *
 * Note what is *not* attempted: Apple Silicon versus Intel. Browsers on ARM
 * Macs report "Intel Mac OS X" for compatibility, so the user agent genuinely
 * cannot answer it. The macOS build is universal precisely so this does not
 * have to guess (see electron-builder.yml).
 *
 * Returns null for anything with no desktop build, which the route turns into
 * the releases page rather than a wrong file.
 */
export function detectDownloadPlatform(userAgent: string): DownloadPlatform | null {
  // Checked before the desktop cases, and this order is load-bearing: an
  // Android user agent also contains "Linux", and iPadOS's contains "Mac OS
  // X". Matching those first would hand a phone a desktop installer.
  if (/Android|iPhone|iPad|iPod/i.test(userAgent)) return null;
  if (/Windows NT/i.test(userAgent)) return "win";
  if (/Mac OS X|Macintosh/i.test(userAgent)) return "mac";
  if (/Linux|X11/i.test(userAgent)) return "linux";
  return null;
}

/** Validates an explicit ?platform= override. */
export function parseDownloadPlatform(raw: string | null | undefined): DownloadPlatform | null {
  return raw === "win" || raw === "mac" || raw === "linux" ? raw : null;
}

/** The asset for `platform` in a release's asset list, or null if absent. */
export function findReleaseAsset(
  assets: readonly ReleaseAsset[] | undefined,
  platform: DownloadPlatform
): ReleaseAsset | null {
  return assets?.find((asset) => ASSET_PATTERN[platform].test(asset.name)) ?? null;
}
