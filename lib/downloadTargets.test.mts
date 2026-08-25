// node --experimental-strip-types lib/downloadTargets.test.mts
//
// /download is a link that gets pasted places and then never revisited, so
// its two decisions have to be right without anyone watching: which platform
// the visitor is on, and which asset that means. Getting either wrong hands
// someone an installer their machine cannot run — a worse outcome than the
// download failing outright, because it fails *after* they double-click it.
import assert from "node:assert/strict";
import {
  detectDownloadPlatform,
  findReleaseAsset,
  parseDownloadPlatform,
  type ReleaseAsset,
} from "./downloadTargets";

// Real user agents, not invented ones — the point is to match what browsers
// actually send.
const UA = {
  win: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  winFirefox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
  macIntel: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  // An Apple Silicon Mac. Reports "Intel Mac OS X" exactly like the line
  // above — which is why the mac build is universal and this test asserts
  // they are indistinguishable rather than pretending otherwise.
  macArm: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
  linux: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  linuxFirefox: "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0",
  android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  ipad: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
};

assert.equal(detectDownloadPlatform(UA.win), "win");
assert.equal(detectDownloadPlatform(UA.winFirefox), "win");
assert.equal(detectDownloadPlatform(UA.macIntel), "mac");
assert.equal(detectDownloadPlatform(UA.macArm), "mac");
assert.equal(detectDownloadPlatform(UA.linux), "linux");
assert.equal(detectDownloadPlatform(UA.linuxFirefox), "linux");

// The ordering traps, and the reason detectDownloadPlatform checks mobile
// first. Android's UA contains "Linux"; iPadOS's contains "Mac OS X". Either
// would match a desktop rule and send a phone a desktop installer.
assert.equal(detectDownloadPlatform(UA.android), null, "Android contém 'Linux'");
assert.equal(detectDownloadPlatform(UA.iphone), null);
assert.equal(detectDownloadPlatform(UA.ipad), null, "iPad contém 'Mac OS X'");
// Nothing recognisable is null rather than a guess.
assert.equal(detectDownloadPlatform(""), null);
assert.equal(detectDownloadPlatform("curl/8.4.0"), null);

// The override is the escape hatch for everything above being wrong, so it
// must accept exactly the three real values and nothing else.
assert.equal(parseDownloadPlatform("win"), "win");
assert.equal(parseDownloadPlatform("mac"), "mac");
assert.equal(parseDownloadPlatform("linux"), "linux");
for (const bad of ["", "WIN", "windows", "darwin", "osx", null, undefined, "../etc"]) {
  assert.equal(parseDownloadPlatform(bad), null, `deveria rejeitar: ${String(bad)}`);
}

// A realistic release: the names electron-builder actually produces, with
// the version embedded — which is exactly why matching is by extension.
const asset = (name: string): ReleaseAsset => ({
  name,
  browser_download_url: `https://github.com/Nem-Tudo/group-sharescreen/releases/download/v1.4.0/${name}`,
});
const assets: ReleaseAsset[] = [
  asset("GoLive-Setup-1.4.0.exe"),
  asset("GoLive-1.4.0-universal.dmg"),
  asset("GoLive-1.4.0.AppImage"),
  asset("GoLive_1.4.0_amd64.deb"),
  // Auto-update metadata and checksums sit alongside the installers and
  // must never be handed to someone as a download.
  asset("latest.yml"),
  asset("latest-mac.yml"),
  asset("GoLive-Setup-1.4.0.exe.blockmap"),
];

assert.equal(findReleaseAsset(assets, "win")?.name, "GoLive-Setup-1.4.0.exe");
assert.equal(findReleaseAsset(assets, "mac")?.name, "GoLive-1.4.0-universal.dmg");
assert.equal(findReleaseAsset(assets, "linux")?.name, "GoLive-1.4.0.AppImage");

// `.exe.blockmap` ends in .blockmap, not .exe — the anchored pattern is what
// keeps it from being served as the Windows installer.
assert.ok(!findReleaseAsset(assets, "win")!.name.endsWith(".blockmap"));

// A release missing a platform must report nothing rather than fall through
// to another platform's file; the route turns null into the releases page.
const winOnly = [asset("GoLive-Setup-2.0.0.exe"), asset("latest.yml")];
assert.equal(findReleaseAsset(winOnly, "mac"), null);
assert.equal(findReleaseAsset(winOnly, "linux"), null);
assert.equal(findReleaseAsset(winOnly, "win")?.name, "GoLive-Setup-2.0.0.exe");

// No release at all, or one with no assets yet (a draft being uploaded).
assert.equal(findReleaseAsset(undefined, "win"), null);
assert.equal(findReleaseAsset([], "win"), null);

console.log("downloadTargets: ok");
