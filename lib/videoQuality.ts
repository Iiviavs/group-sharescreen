// Shared video-quality model: the single source of truth for what a given
// quality tier costs, used by three separate consumers that must agree or
// the topology planner's arithmetic silently drifts from what the encoder
// actually does:
//   - useRoomMedia's per-peer sender configuration (what we actually encode)
//   - capacity.ts (how much of a node's budget a stream consumes)
//   - topologyPlanner.ts (whether a node can afford one more child)
//
// Two independent costs are tracked per tier, because in a mesh they run out
// at different times and for different reasons:
//   - upload, in kbps — the link
//   - encode, in megapixels/second — the CPU
// A 2-core laptop hits the encode wall long before its fibre link fills up;
// a desktop on ADSL hits the opposite. Modelling only bandwidth (as the old
// BITRATE_KBPS/THROTTLE_* tables did) is what let the app promise 1080p60 to
// a room it could never encode for.

export type QualityTier = "1080p60" | "1080p30" | "720p30" | "540p30" | "360p30" | "360p15";

export interface TierSpec {
  tier: QualityTier;
  width: number;
  height: number;
  frameRate: number;
  // Bitrate for *motion-heavy* content (video/game). Real cost is this times
  // the measured content multiplier — see contentMultiplier below.
  baseKbps: number;
}

// Ordered best-to-worst. Every "step down one tier" operation in this app is
// an index walk over this array, so the order is load-bearing.
export const TIERS: readonly TierSpec[] = [
  { tier: "1080p60", width: 1920, height: 1080, frameRate: 60, baseKbps: 5000 },
  { tier: "1080p30", width: 1920, height: 1080, frameRate: 30, baseKbps: 3000 },
  { tier: "720p30", width: 1280, height: 720, frameRate: 30, baseKbps: 1500 },
  { tier: "540p30", width: 960, height: 540, frameRate: 30, baseKbps: 900 },
  { tier: "360p30", width: 640, height: 360, frameRate: 30, baseKbps: 500 },
  { tier: "360p15", width: 640, height: 360, frameRate: 15, baseKbps: 300 },
] as const;

const TIER_INDEX = new Map<QualityTier, number>(TIERS.map((t, i) => [t.tier, i]));

export function tierSpec(tier: QualityTier): TierSpec {
  return TIERS[TIER_INDEX.get(tier) ?? 0];
}

export function tierIndex(tier: QualityTier): number {
  return TIER_INDEX.get(tier) ?? 0;
}

export const BEST_TIER = TIERS[0].tier;
export const WORST_TIER = TIERS[TIERS.length - 1].tier;

/** Steps `tier` down by `steps` places, clamped at the worst tier. */
export function stepDown(tier: QualityTier, steps: number): QualityTier {
  if (steps <= 0) return tier;
  return TIERS[Math.min(tierIndex(tier) + steps, TIERS.length - 1)].tier;
}

/** Steps `tier` up by `steps` places, clamped at the best tier. */
export function stepUp(tier: QualityTier, steps: number): QualityTier {
  if (steps <= 0) return tier;
  return TIERS[Math.max(tierIndex(tier) - steps, 0)].tier;
}

/** The lower (worse) of two tiers — used when several constraints each cap quality. */
export function minTier(a: QualityTier, b: QualityTier): QualityTier {
  return tierIndex(a) >= tierIndex(b) ? a : b;
}

// Encode cost proxy: pixels per second. Encoder CPU tracks this far better
// than it tracks bitrate — 360p15 is ~35x cheaper to encode than 1080p60
// even though it's only ~17x cheaper in bits. That gap is exactly why
// per-viewer tiering relieves the CPU wall harder than it relieves the link.
export function encodeMpxs(tier: QualityTier): number {
  const s = tierSpec(tier);
  return (s.width * s.height * s.frameRate) / 1e6;
}

// How expensive the *content* is, relative to motion-heavy video. The old
// preset system assumed every "1080p60" costs the same 5 Mbps; in reality a
// static IDE costs about an eighth of a 60fps game at the identical tier.
// Encoding a still screen is nearly free because the encoder simply emits
// almost nothing when nothing changes.
export type ContentProfile = "static" | "slides" | "browsing" | "video" | "game";

const CONTENT_MULTIPLIER: Record<ContentProfile, number> = {
  static: 0.12,
  slides: 0.25,
  browsing: 0.5,
  video: 1.0,
  game: 1.2,
};

export function contentMultiplier(profile: ContentProfile): number {
  return CONTENT_MULTIPLIER[profile];
}

/**
 * Upload cost of serving one viewer at `tier`, in kbps.
 *
 * `measuredMultiplier` should come from real encoder output when available
 * (see measureContentMultiplier) rather than the ContentProfile guess — the
 * guess exists only to seed the very first seconds of a share, before any
 * outbound-rtp stats have accumulated.
 */
export function uploadKbps(tier: QualityTier, measuredMultiplier: number): number {
  return tierSpec(tier).baseKbps * measuredMultiplier;
}

/**
 * Derives the content multiplier from what the encoder actually produced:
 * observed bitrate over the bitrate this tier would cost for motion content.
 * Clamped because a momentarily-idle screen would otherwise drive this to ~0
 * and make the planner believe a node can serve unlimited children, right up
 * until the content moves again and everything collapses at once.
 */
export function measureContentMultiplier(observedKbps: number, tier: QualityTier): number {
  const base = tierSpec(tier).baseKbps;
  if (base <= 0 || observedKbps <= 0) return 1;
  return Math.min(1.5, Math.max(0.1, observedKbps / base));
}

// Hysteresis band for tile-size-driven tier selection. Without it a tile
// sitting exactly on a tier boundary (a resizing grid, a CSS transition)
// renegotiates every few frames, and each renegotiation is a setParameters
// call plus a signalling round trip.
const UPGRADE_MARGIN = 1.25;

/**
 * Picks the tier for a stream rendered into `renderedWidth` x `renderedHeight`
 * CSS pixels. This is the single highest-impact optimisation in the app: in a
 * 30-person grid each tile is ~320x216, so sending 1080p wastes ~95% of the
 * encoded pixels — on the sender's CPU *and* on the sender's uplink.
 *
 * `devicePixelRatio` matters: a 320px tile on a 2x display genuinely needs
 * 640 device pixels to avoid looking soft, so ignoring DPR would make every
 * retina viewer's video visibly blurry.
 *
 * `currentTier`, when supplied, applies hysteresis: we drop to a lower tier
 * as soon as it suffices, but only climb when the tile is comfortably past
 * the next tier's width, never on a one-pixel wobble.
 */
export function tierForRenderedSize(
  renderedWidth: number,
  renderedHeight: number,
  devicePixelRatio: number,
  currentTier?: QualityTier,
  maxFps = 60
): QualityTier {
  const dpr = Math.max(1, Math.min(3, devicePixelRatio || 1));
  const needW = renderedWidth * dpr;
  const needH = renderedHeight * dpr;

  // A tile that isn't laid out yet (0x0, display:none, off-screen) must not
  // be read as "needs nothing" — that would pin it to the worst tier and it
  // would stay there after becoming visible. Callers skip reporting instead.
  if (needW <= 0 || needH <= 0) return currentTier ?? WORST_TIER;

  const eligible = TIERS.filter((t) => t.frameRate <= maxFps);
  const pool = eligible.length > 0 ? eligible : TIERS;

  // Smallest resolution that still covers the tile — then, among tiers
  // sharing that resolution, the *highest* frame rate.
  //
  // The tie-break matters. Walking plainly from the worst tier upwards would
  // hand a small tile 360p15, because 15fps sorts below 30fps at identical
  // resolution. Nobody asked for choppy video by making their window small:
  // tile size is evidence about how many *pixels* are useful and says nothing
  // about frame rate. Dropping frames is a response to pressure — congestion
  // (peerQualityController) or a depth penalty (topologyPlanner) — and those
  // reach the lower-fps tiers by stepping down explicitly.
  const covering = pool.filter((t) => t.width >= needW && t.height >= needH);
  let chosen = pool[0].tier;
  if (covering.length > 0) {
    const best = covering.reduce((a, b) => {
      const areaA = a.width * a.height;
      const areaB = b.width * b.height;
      if (areaA !== areaB) return areaA < areaB ? a : b;
      return a.frameRate >= b.frameRate ? a : b;
    });
    chosen = best.tier;
  }

  if (!currentTier) return chosen;

  // Hysteresis only guards *upgrades*. Downgrading immediately is always
  // safe and always saves resources, so it is deliberately not damped.
  //
  // The comparison is against the tier we are already on, not the one being
  // proposed: the question is "has this tile outgrown what it currently
  // gets?", and requiring it to exceed the current tier's own width by a
  // clear margin is what stops a slowly-dragged window from renegotiating at
  // every boundary crossing.
  if (tierIndex(chosen) < tierIndex(currentTier)) {
    const current = tierSpec(currentTier);
    if (needW <= current.width * UPGRADE_MARGIN) return currentTier;
  }
  return chosen;
}

/** Cap a tier by the broadcaster's own chosen ceiling (their quality dial). */
export function capTier(requested: QualityTier, ceiling: QualityTier): QualityTier {
  return minTier(requested, ceiling);
}

/**
 * scaleResolutionDownBy needed to get from the captured track's height down
 * to `tier`'s height. WebRTC expresses per-sender downscaling as a divisor,
 * not a target size, so this is what actually applies a tier to one peer.
 */
export function scaleFactorFor(tier: QualityTier, captureHeight: number): number {
  const target = tierSpec(tier).height;
  if (!captureHeight || captureHeight <= target) return 1;
  // Clamped to 1 so a capture smaller than the tier never *upscales*, and
  // rounded to 2dp because browsers reject absurdly precise divisors.
  return Math.max(1, Math.round((captureHeight / target) * 100) / 100);
}

// Absolute bitrate floor for a congested link, on top of the proportional
// MIN_RATIO in peerQualityController. Ported from upstream's own fix to this
// same problem (commit "fix screenshare"): a ratio alone is not enough of a
// guard, because 20% of a cheap tier is a genuinely unusable picture — 20% of
// 360p15's budget is not video, it is a slideshow of artefacts. Below this
// there is nothing worth sending, so stop backing off and let frames drop.
const MIN_KBPS = 250;

/**
 * The bitrate to actually request for one peer, given what its tier costs and
 * how much of that its link is currently carrying.
 *
 * The clamp is two-sided on purpose: the floor stops a congested peer from
 * being driven down to unusable video, but must never *raise* a cheap tier
 * above its own budget — a 360p15 stream asked for 250 kbps when it only
 * costs 150 would spend bits the tier deliberately does not want.
 */
export function congestedBitrateKbps(tierKbps: number, ratio: number): number {
  return Math.round(Math.max(Math.min(MIN_KBPS, tierKbps), tierKbps * ratio));
}
