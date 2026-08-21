// node --experimental-strip-types lib/meshQuality.test.mts
//
// Pins the two pure pieces the whole mesh strategy rests on: how a rendered
// tile size becomes a quality tier, and how the topology planner decides
// between plain mesh and a cascade. Both are pure functions, so they are
// testable without a browser, a peer connection, or a room.

import assert from "node:assert/strict";
import {
  capTier,
  congestedBitrateKbps,
  encodeMpxs,
  encoderCeilingKbps,
  measureContentMultiplier,
  scaleFactorFor,
  stepDown,
  tierForRenderedSize,
  tierSpec,
  uploadKbps,
  TIERS,
} from "./videoQuality";
import { fitsDirectMesh, planTopology, type PlannerViewer } from "./topologyPlanner";

// --- tier selection -------------------------------------------------------

// The case the entire optimisation exists for: a 30-person grid on a 1080p
// screen gives each tile ~320x216, which must not pull 1080p.
assert.equal(tierForRenderedSize(320, 216, 1), "576p30");
// 576p is the floor, so nothing — however small the tile — goes below it.
assert.equal(tierForRenderedSize(160, 90, 1), "576p30", "nada desce abaixo do piso");
assert.ok(
  TIERS.every((t) => t.height >= 576),
  "a escada não pode ter nenhum degrau abaixo de 576p"
);
// devicePixelRatio still decides between rungs: a 640x360 tile fits the floor
// on a 1x display and genuinely needs 1280x720 device pixels on a retina one.
assert.equal(tierForRenderedSize(640, 360, 1), "576p30");
assert.equal(tierForRenderedSize(640, 360, 2), "720p60");
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

// Hysteresis guards upgrades only. Current tier 720p30 is 1280 wide, so a tile
// must clear 1280 * 1.25 = 1600 device px before it renegotiates upward.
assert.equal(tierForRenderedSize(1500, 844, 1, "720p30"), "720p30", "não deve subir dentro da margem");
assert.equal(tierForRenderedSize(1700, 956, 1, "720p30"), "1080p60", "deve subir quando cresce de verdade");
// Downgrades are never damped — they always save resources immediately.
assert.equal(tierForRenderedSize(320, 216, 1, "1080p60"), "576p30", "descida é imediata");

// maxFps caps the pool: a 30fps share can never be assigned a 60fps tier.
assert.equal(tierForRenderedSize(1920, 1080, 1, undefined, 30), "1080p30");

// The ladder must offer 60fps at every resolution someone can actually pick,
// not only at 1080p. It used not to, and the consequence was silent: a
// broadcaster who chose 720p60 was served 720p30 because that was the only
// 720p tier in existence.
assert.equal(tierForRenderedSize(1280, 720, 1, undefined, 60), "720p60");
assert.equal(tierForRenderedSize(2560, 1440, 1, undefined, 60), "1440p60");
assert.equal(tierForRenderedSize(2560, 1440, 1, undefined, 30), "1440p30");
// There is deliberately no 576p60: the floor is where every small tile lands,
// and the resolution tie-break prefers the higher frame rate, so a 60fps rung
// there would hand 60fps to a whole grid of thumbnails at once. Asking for
// 576p at 60fps gets the resolution, at the frame rate the floor offers.
assert.equal(tierForRenderedSize(1024, 576, 1, undefined, 60), "576p30");

// --- ladder invariants ----------------------------------------------------

// Both cost columns must fall monotonically down the ladder. Every "step down
// one tier" in the app is an index walk, and the planner's "retry a tier
// lower until the room fits" loop is only correct if a step down always frees
// both bandwidth and CPU.
for (let i = 1; i < TIERS.length; i += 1) {
  const better = TIERS[i - 1];
  const worse = TIERS[i];
  assert.ok(
    worse.baseKbps < better.baseKbps,
    `${worse.tier} deveria custar menos banda que ${better.tier}`
  );
  assert.ok(
    encodeMpxs(worse.tier) < encodeMpxs(better.tier),
    `${worse.tier} deveria custar menos CPU que ${better.tier}`
  );
}

// --- ceilings -------------------------------------------------------------

// The broadcaster's three dials are independent, and capTier is where that is
// enforced: it clamps pixels and frames separately instead of picking "the
// worse of two tiers" off a single ladder, which cannot express "1080p but
// only 30fps" at all.
assert.equal(capTier("720p60", "1080p30"), "720p30", "teto de 30fps limita fps");
assert.equal(capTier("1080p60", "720p60"), "720p60", "teto de 720p limita resolução");
assert.equal(capTier("1440p60", "1080p60"), "1080p60");
assert.equal(capTier("576p30", "1080p60"), "576p30", "quem pede pouco continua recebendo pouco");
assert.equal(capTier("1080p60", "1080p60"), "1080p60", "teto igual ao pedido não mexe em nada");

// What the encoder is handed is a *ceiling*, and a ceiling set at the tier's
// average clips every busy moment. This is the regression that made shares
// look frozen, so it is pinned: at the default dial, the allowance is above
// the average cost, never at it.
for (const t of TIERS) {
  const ceiling = encoderCeilingKbps(t.tier, 4000);
  assert.ok(
    ceiling > t.baseKbps || ceiling === 4000,
    `${t.tier} deveria ter folga acima da média (veio ${ceiling} para base ${t.baseKbps})`
  );
}
// The dial is a hard limit in both directions: it caps the cheap settings and
// genuinely lifts the expensive ones. "ultra" and "máximo" used to be the
// same tier, i.e. the same setting sold twice.
assert.equal(encoderCeilingKbps("1080p60", 700), 700, "bitrate baixo é um teto de verdade");
assert.ok(
  encoderCeilingKbps("1080p60", 16000) > encoderCeilingKbps("1080p60", 8000),
  "máximo precisa entregar mais que ultra"
);
// ...and it scales down the ladder: a thumbnail must not be handed a 16 Mbps
// allowance just because the broadcaster picked the top setting.
assert.ok(
  encoderCeilingKbps("576p30", 16000) < encoderCeilingKbps("1080p60", 16000),
  "tier pequeno não deve receber a mesma verba do tier grande"
);
assert.equal(
  encoderCeilingKbps("1080p30", 4000),
  Math.round(Math.min(4000, tierSpec("1080p30").baseKbps * 1.5))
);

// --- cost model -----------------------------------------------------------

// Encode cost must fall much faster than bitrate as tiers drop - that gap is
// why per-viewer tiering relieves the CPU wall harder than the link.
const bitrateRatio = uploadKbps("1080p60", 1) / uploadKbps("576p15", 1);
const encodeRatio = encodeMpxs("1080p60") / encodeMpxs("576p15");
assert.ok(encodeRatio > bitrateRatio * 1.5, `encode ${encodeRatio} deveria cair muito mais que bitrate ${bitrateRatio}`);

// Content multiplier is clamped: a momentarily static screen must not
// convince the planner that capacity is unlimited.
assert.ok(measureContentMultiplier(1, "1080p60") >= 0.1);
assert.ok(measureContentMultiplier(999999, "576p15") <= 1.5);

// Downscaling never upscales a capture that is already small.
assert.equal(scaleFactorFor("1080p60", 720), 1);
assert.equal(scaleFactorFor("576p30", 1080), 1.88);

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
  ...Array.from({ length: 22 }, (_, i) => strongViewer(`gr${i}`, "576p30")),
];

// ~12 cores' worth of encode budget (see seedEncodeBudget). This used to be
// 900 and no longer suffices for the room above: with the ladder's floor
// raised to 576p, a grid thumbnail costs ~2.6x the encode it used to, and 22
// of them is most of the bill.
const desktop = { id: "host", uploadKbps: 100_000, encodeMpxs: 1200, stableSeconds: 999, eligibleRelay: true };

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
assert.equal(congestedBitrateKbps(5600, 0.02), 500, "congestionamento pesado para no piso");
// And the floor must not become a *ceiling lift*: a tier that deliberately
// costs less than the floor is never pushed above its own budget.
assert.equal(congestedBitrateKbps(150, 0.1), 150, "tier barato nunca sobe por causa do piso");
assert.equal(congestedBitrateKbps(150, 1), 150);

console.log("meshQuality: ok");
