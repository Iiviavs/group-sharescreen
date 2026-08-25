// node --experimental-strip-types lib/desktop.test.mts
//
// The desktop OAuth handoff has three parties that must agree on one string
// format, and none of them can see the others fail:
//
//   - the app (electron/main.ts) plants a nonce and later matches it,
//   - the API preserves only the *pathname* of `returnTo`,
//   - the callback page, running in a completely different browser, decides
//     from that pathname alone whether to hand the result to the app.
//
// So this pins the round trip and — more importantly — the rejections. A
// nonce parser that is too permissive is the actual security boundary here:
// any program on the machine can register `golive://` and fire an
// unsolicited `#token=...` at the app, and the only thing that stops it
// being accepted is failing to name a login currently in flight.
import assert from "node:assert/strict";
import {
  DESKTOP_OAUTH_RETURN_PREFIX,
  desktopOAuthNonce,
  desktopOAuthReturnPath,
  createOAuthNonce,
} from "./desktop";

// Round trip: what we plant is what we read back.
for (let i = 0; i < 200; i += 1) {
  const nonce = createOAuthNonce();
  assert.equal(desktopOAuthNonce(desktopOAuthReturnPath(nonce)), nonce);
}

// The generated nonce must itself satisfy the parser's own shape rule —
// otherwise every login would be rejected the moment it came back.
const sample = createOAuthNonce();
assert.ok(/^[a-zA-Z0-9_-]{8,128}$/.test(sample), `nonce inválido: ${sample}`);
// 24 random bytes as hex. Long enough that guessing it is not a strategy.
assert.equal(sample.length, 48);
// Two calls must not collide, or the "matches a login in flight" check would
// be matching the wrong flight.
assert.notEqual(createOAuthNonce(), createOAuthNonce());

// A trailing slash is tolerated: some OSes normalise a custom-protocol URL
// by appending one, and dropping a real login over that would be a bug the
// user could never explain.
assert.equal(desktopOAuthNonce(`${DESKTOP_OAUTH_RETURN_PREFIX}abcd1234/`), "abcd1234");

// Everything that is not a desktop login must read as null, so the callback
// page falls through to its ordinary popup/redirect handling.
assert.equal(desktopOAuthNonce("/"), null);
assert.equal(desktopOAuthNonce("/watch/sala"), null);
assert.equal(desktopOAuthNonce(""), null);
// Right prefix, unusable nonce — rejected rather than half-accepted.
assert.equal(desktopOAuthNonce(DESKTOP_OAUTH_RETURN_PREFIX), null);
assert.equal(desktopOAuthNonce(`${DESKTOP_OAUTH_RETURN_PREFIX}short`), null, "curto demais");
assert.equal(desktopOAuthNonce(`${DESKTOP_OAUTH_RETURN_PREFIX}${"a".repeat(129)}`), null, "longo demais");
// Characters outside the alphabet are refused instead of being stripped: a
// nonce is only ever compared for equality, so anything that does not match
// the generator cannot be a login of ours.
assert.equal(desktopOAuthNonce(`${DESKTOP_OAUTH_RETURN_PREFIX}abcd/../../evil`), null);
assert.equal(desktopOAuthNonce(`${DESKTOP_OAUTH_RETURN_PREFIX}abcd1234?x=1`), null);
assert.equal(desktopOAuthNonce(`${DESKTOP_OAUTH_RETURN_PREFIX}abcd 1234`), null);
// A prefix match that isn't at the start must not count.
assert.equal(desktopOAuthNonce(`/watch${DESKTOP_OAUTH_RETURN_PREFIX}abcd1234`), null);

console.log("desktop: ok");
