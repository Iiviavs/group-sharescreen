// Node resolution hook for running the .test.mts files directly.
//
// The app's imports are extensionless ("./videoQuality") because the Next
// bundler resolves them that way. Node's ESM resolver does not, so this maps
// a failed bare-relative resolution onto the matching .ts/.tsx file. Node 22+
// strips the types itself; nothing here compiles anything.
//
//   node --import ./lib/ts-resolve.mjs --experimental-strip-types lib/foo.test.mts
import { register } from "node:module";
import { pathToFileURL } from "node:url";

if (!process.env.__TS_RESOLVE_REGISTERED) {
  process.env.__TS_RESOLVE_REGISTERED = "1";
  register("./ts-resolve-hooks.mjs", pathToFileURL(import.meta.filename));
}
