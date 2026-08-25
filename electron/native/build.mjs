// Compiles the WASAPI capture helper (src/audiocap.cpp) into bin/.
//
// Runs as part of `npm run electron:build` on every platform, and is a
// deliberate no-op on all of them except Windows: process loopback is a
// Windows API, the shell already falls back to Electron's own loopback
// capture when the binary is absent, and failing the build on macOS would
// stop the release workflow from producing a Mac app at all.
//
// It shells out to MSVC rather than using node-gyp because there is no Node
// addon here — see the header comment in src/audiocap.cpp for why this is a
// standalone executable. That choice is what keeps this off the
// node-addon-api / prebuild / per-Electron-version treadmill: the output is
// an ordinary .exe with no ABI to match.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.join(here, "src", "audiocap.cpp");
const outdir = path.join(here, "bin");
const output = path.join(outdir, "golive-audiocap.exe");
// Objects go outside bin/ because bin/ holds a *committed* binary, and a
// directory that is half checked-in artefact and half build litter is one
// stray `git add .` away from a mess.
const objdir = path.join(here, ".obj");
// The source hash the committed binary was built from. Recorded next to it
// because timestamps cannot answer this question: git does not preserve
// mtimes, so every file in a fresh clone is stamped at checkout time and
// comparing them decides "is this stale" by coin flip. A hash makes the
// answer the same on every machine — and it is what lets anyone tell whether
// the .exe in the repo actually corresponds to the .cpp next to it.
const stamp = `${output}.sha256`;

function sourceHash() {
  return createHash("sha256").update(readFileSync(source)).digest("hex");
}

function stampedHash() {
  try {
    return readFileSync(stamp, "utf8").trim();
  } catch {
    return null;
  }
}

const force = process.argv.includes("--force");
// Turns "no toolchain, carry on" into a build failure. Passed by the release
// workflow and nowhere else: a developer's machine without MSVC should still
// be able to build and run the app, but a *release* that silently shipped
// without the helper would be a feature quietly disappearing from an
// installer, with the symptom (everyone echoing again) reported weeks later.
const required = process.argv.includes("--required");

if (process.platform !== "win32") {
  console.log("[native] not Windows — skipping golive-audiocap");
  process.exit(0);
}

const hash = sourceHash();
const upToDate = existsSync(output) && stampedHash() === hash;

// The common path by a wide margin: the binary is committed to the repo
// (built by .github/workflows/build-audiocap.yml), so a fresh clone already
// has a current one and nothing needs a compiler at all. Also what keeps
// `electron:dev` — which runs the whole build on every launch — from
// recompiling for nothing.
if (!force && upToDate) {
  console.log("[native] golive-audiocap.exe is up to date");
  process.exit(0);
}

// vswhere ships with every Visual Studio 2017+ installer at a fixed path,
// which makes it the only supported way to find an installation — the
// registry keys and %VS...COMNTOOLS% variables it replaced are gone.
const vswhere = path.join(
  process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
  "Microsoft Visual Studio",
  "Installer",
  "vswhere.exe"
);

function findVsDevCmd() {
  if (!existsSync(vswhere)) return null;
  const found = spawnSync(
    vswhere,
    [
      "-latest",
      "-products",
      "*",
      // Asking for the C++ toolset specifically, not just "a Visual Studio":
      // an install with only the .NET workload has no cl.exe, and finding it
      // here would produce a much more confusing failure further down.
      "-requires",
      "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
      "-property",
      "installationPath",
    ],
    { encoding: "utf8" }
  );
  const root = found.stdout?.trim().split(/\r?\n/)[0];
  if (!root) return null;
  const devcmd = path.join(root, "Common7", "Tools", "VsDevCmd.bat");
  return existsSync(devcmd) ? devcmd : null;
}

const devcmd = findVsDevCmd();
if (!devcmd) {
  // Not fatal by default, and the two cases mean very different things —
  // saying so matters, because "no compiler" reads as a broken checkout when
  // in practice the committed binary makes it a non-event.
  const message = existsSync(output)
    ? "golive-audiocap.exe does not match audiocap.cpp, and there is no MSVC\n" +
      "[native] toolchain here to rebuild it. Using the committed binary as-is — it works,\n" +
      "[native] but it predates your source changes. Push them and let\n" +
      "[native] .github/workflows/build-audiocap.yml rebuild it, or install the Visual Studio\n" +
      '[native] Build Tools "Desktop development with C++" workload to do it locally.'
    : "no golive-audiocap.exe and no MSVC toolchain to build one.\n" +
      "[native] The app falls back to Electron's loopback capture, which cannot exclude\n" +
      "[native] GoLive itself — so the room hears its own echo in a share. The binary is\n" +
      "[native] normally committed to electron/native/bin; a checkout missing it is unusual.";
  if (required) {
    console.error(`[native] ${message}`);
    process.exit(1);
  }
  console.warn(`[native] ${message}`);
  process.exit(0);
}

mkdirSync(outdir, { recursive: true });
mkdirSync(objdir, { recursive: true });

// /MT statically links the CRT. That matters for something we ship: with
// /MD the helper needs the Visual C++ redistributable installed on the
// user's machine, and its absence shows up as the helper failing to start
// with no diagnostic anywhere.
//
// mmdevapi.lib is where ActivateAudioInterfaceAsync lives; avrt.lib is
// AvSetMmThreadCharacteristics.
const compile = [
  "cl",
  "/nologo",
  "/std:c++17",
  "/EHsc",
  "/O2",
  "/MT",
  "/W3",
  "/DUNICODE",
  "/D_UNICODE",
  `/Fo:${path.join(objdir, "")}`,
  quote(source),
  `/Fe:${quote(output)}`,
  "/link",
  "ole32.lib",
  "mmdevapi.lib",
  "avrt.lib",
  "/SUBSYSTEM:CONSOLE",
].join(" ");

function quote(value) {
  return `"${value}"`;
}

// One cmd.exe invocation for both halves: VsDevCmd.bat sets the environment
// (INCLUDE, LIB, PATH) in the shell it runs in, so a separate spawn for cl
// would not see any of it. -arch/-host_arch are explicit because the default
// is x86, which would produce a 32-bit helper for a 64-bit app.
const result = spawnSync(
  process.env.ComSpec || "cmd.exe",
  ["/d", "/s", "/c", `""${devcmd}" -arch=x64 -host_arch=x64 -no_logo && ${compile}"`],
  { stdio: "inherit", windowsVerbatimArguments: true }
);

if (result.status !== 0) {
  console.error("[native] golive-audiocap failed to build");
  process.exit(1);
}

// Written only after a successful compile, so an interrupted build leaves a
// stamp that does not match and the next run rebuilds rather than trusting a
// half-written executable.
writeFileSync(stamp, `${hash}
`);

console.log(`[native] built ${path.relative(process.cwd(), output)}`);
