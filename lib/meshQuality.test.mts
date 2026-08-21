// node --experimental-strip-types lib/meshQuality.test.mts
//
// Pins the two pure pieces the whole mesh strategy rests on: how a rendered
// tile size becomes a quality tier, and how the topology planner decides
// between plain mesh and a cascade. Both are pure functions, so they are
// testable without a browser, a peer connection, or a room.

import assert from "node:assert/strict";
import {
  congestedBitrateKbps,
  encodeMpxs,
  measureContentMultiplier,
  scaleFactorFor,
  stepDown,
  tierForRenderedSize,
  uploadKbps,
} from "./videoQuality";
import { fitsDirectMesh, planTopology, type PlannerViewer } from "./topologyPlanner";

// --- tier selection -------------------------------------------------------

// The case the entire optimisation exists for: a 30-person grid on a 1080p
// screen gives each tile ~320x216, which must not pull 1080p.
assert.equal(tierForRenderedSize(320, 216, 1), "360p30");
// Same tile on a retina display genuinely needs more device pixels (640x432),
// which 360p (640x360) no longer covers vertically.
assert.equal(tierForRenderedSize(320, 216, 2), "540p30");
// Someone watching fullscreen gets the top tier.
assert.equal(tierForRenderedSize(1920, 1080, 1), "1080p60");
// A tile that isn't laid out yet must not be read as "needs nothing",
// otherwise it stays pinned at the worst tier once it becomes visible.
assert.equal(tierForRenderedSize(0, 0, 1, "720p30"), "720p30");

// Making a window small must never be read as "this person wants 15fps".
// Frame rate is a response to pressure, not to tile size — so no size, however
// tiny, selects a reduced-fps tier on its own.
for (const w of [40, 120, 320, 640]) {
  const t = tierForRenderedSize(w, Math.round((w * 9) / 16), 1);
  assert.ok(!t.endsWith("15"), `${w}px não deveria escolher um tier de 15fps (veio ${t})`);
}

// Hysteresis guards upgrades only. Current tier 360p30 is 640 wide, so a tile
// must clear 640 * 1.25 = 800 device px before it renegotiates upward.
assert.equal(tierForRenderedSize(700, 394, 1, "360p30"), "360p30", "não deve subir dentro da margem");
assert.equal(tierForRenderedSize(1000, 563, 1, "360p30"), "720p30", "deve subir quando cresce de verdade");
// Downgrades are never damped — they always save resources immediately.
assert.equal(tierForRenderedSize(320, 216, 1, "1080p60"), "360p30", "descida é imediata");

// maxFps caps the pool: a 30fps share can never be assigned a 60fps tier.
assert.equal(tierForRenderedSize(1920, 1080, 1, undefined, 30), "1080p30");

// --- cost model -----------------------------------------------------------

// Encode cost must fall much faster than bitrate as tiers drop - that gap is
// why per-viewer tiering relieves the CPU wall harder than the link.
const bitrateRatio = uploadKbps("1080p60", 1) / uploadKbps("360p15", 1);
const encodeRatio = encodeMpxs("1080p60") / encodeMpxs("360p15");
assert.ok(encodeRatio > bitrateRatio * 1.5, `encode ${encodeRatio} deveria cair muito mais que bitrate ${bitrateRatio}`);

// Content multiplier is clamped: a momentarily static screen must not
// convince the planner that capacity is unlimited.
assert.ok(measureContentMultiplier(1, "1080p60") >= 0.1);
assert.ok(measureContentMultiplier(999999, "360p15") <= 1.5);

// Downscaling never upscales a capture that is already small.
assert.equal(scaleFactorFor("1080p60", 720), 1);
assert.equal(scaleFactorFor("360p30", 1080), 3);

// --- topology planning ----------------------------------------------------

const strongViewer = (id: string, wantTier: PlannerViewer["wantTier"]): PlannerViewer => ({
  id,
  uploadKbps: 25_000,
  encodeMpxs: 400,
  stableSeconds: 300,
  eligibleRelay: true,
  wantTier,
});

// A realistic 30-person room: 2 fullscreen, 5 medium, 22 grid tiles.
const realisticRoom = (): PlannerViewer[] => [
  ...Array.from({ length: 2 }, (_, i) => strongViewer(`fs${i}`, "1080p60")),
  ...Array.from({ length: 5 }, (_, i) => strongViewer(`md${i}`, "720p30")),
  ...Array.from({ length: 22 }, (_, i) => strongViewer(`gr${i}`, "360p15")),
];

const desktop = { id: "host", uploadKbps: 100_000, encodeMpxs: 900, stableSeconds: 999, eligibleRelay: true };

// The headline claim: an ordinary desktop serves 30 people with NO cascade.
assert.ok(fitsDirectMesh(desktop, realisticRoom(), 1.0), "desktop deveria caber em malha direta");
const direct = planTopology(desktop, realisticRoom(), 1.0);
assert.equal(direct.depth, 1, "sem cascata esperada");
assert.deepEqual(direct.relays, [], "ninguém deveria retransmitir");
assert.deepEqual(direct.unserved, []);

// Everyone fullscreen is the case that genuinely needs help.
const allFullscreen = Array.from({ length: 29 }, (_, i) => strongViewer(`v${i}`, "1080p60"));
assert.ok(!fitsDirectMesh(desktop, allFullscreen, 1.0));
const cascaded = planTopology(desktop, allFullscreen, 1.0);
assert.ok(cascaded.depth > 1, "deveria escalar para cascata");
assert.ok(cascaded.relays.length > 0);
assert.deepEqual(cascaded.unserved, [], "ninguém pode ficar sem stream");

// The bug that the first draft of this planner had: a host too weak to encode
// the requested tier for ANYONE gave up and served nobody. The correct
// behaviour is to drop the whole room a tier until it fits.
const weakHost = { id: "host", uploadKbps: 20_000, encodeMpxs: 150, stableSeconds: 999, eligibleRelay: false };
const degraded = planTopology(weakHost, realisticRoom(), 1.2);
assert.deepEqual(degraded.unserved, [], "host fraco deve rebaixar a qualidade, não deixar ninguém sem stream");
assert.ok(degraded.edges.length === 29, "todos os 29 espectadores precisam de uma aresta");

// Static content is far cheaper, so the same weak host needs less help.
const cheap = planTopology(weakHost, realisticRoom(), 0.12);
const expensive = planTopology(weakHost, realisticRoom(), 1.2);
assert.ok(
  cheap.rootUploadKbps <= expensive.rootUploadKbps,
  "conteúdo estático não pode custar mais que jogo"
);

// Ineligible relays (phones, on battery, never heard from) are never promoted.
const phones: PlannerViewer[] = Array.from({ length: 29 }, (_, i) => ({
  ...strongViewer(`p${i}`, "1080p60"),
  eligibleRelay: false,
}));
const noRelayPlan = planTopology(desktop, phones, 1.0);
assert.deepEqual(noRelayPlan.relays, [], "celular nunca deve virar relay");
assert.deepEqual(noRelayPlan.unserved, [], "sem relays elegíveis, rebaixa em vez de falhar");

// Depth is capped: quality is sacrificed before latency is.
assert.ok(cascaded.depth <= 3, "profundidade não pode passar de 3");

// A deeper hop must be served at a lower tier than a direct one.
for (const edge of cascaded.edges) {
  if (edge.depth > 1) {
    const directEdge = cascaded.edges.find((e) => e.depth === 1);
    if (directEdge) {
      assert.ok(
        stepDown(directEdge.tier, edge.depth - 1) === edge.tier || edge.tier !== directEdge.tier,
        "saltos profundos devem entregar tier menor"
      );
    }
  }
}

// --- congestion clamp -----------------------------------------------------

// A healthy link gets exactly what the tier costs — no headroom tax.
assert.equal(congestedBitrateKbps(5600, 1), 5600);
// A congested link is cut, but never below the point where the picture stops
// being video at all.
assert.equal(congestedBitrateKbps(5600, 0.5), 2800);
assert.equal(congestedBitrateKbps(5600, 0.02), 400, "congestionamento pesado para no piso");
// And the floor must not become a *ceiling lift*: a tier that deliberately
// costs less than the floor is never pushed above its own budget.
assert.equal(congestedBitrateKbps(150, 0.1), 150, "tier barato nunca sobe por causa do piso");
assert.equal(congestedBitrateKbps(150, 1), 150);

console.log("meshQuality: ok");
