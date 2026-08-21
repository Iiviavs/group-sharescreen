// Topology planner: decides who sends to whom.
//
// The governing idea is that cascading is an *escape hatch*, not an
// architecture. Relaying costs a full decode+re-encode on a participant's
// machine (browsers have no RTP passthrough — WebRTC Encoded Transforms are
// explicitly not specified for cross-PeerConnection forwarding), so every
// extra hop costs latency, a generation of re-encoding, and someone's CPU.
// The plan therefore stays at depth 1 — plain direct mesh, nobody relaying —
// for as long as the root's *measured* budget covers the room, and only
// deepens when it genuinely cannot.
//
// With per-viewer tiering in place (see videoQuality.tierForRenderedSize),
// depth 1 covers a great deal more than it looks: a 30-person room where
// most viewers are small grid tiles costs roughly 24 Mbps and 460 Mpx/s,
// which an ordinary desktop serves directly. Cascading then only engages for
// a weak uplink, a weak CPU, or the everyone-goes-fullscreen case.

import {
  encodeMpxs,
  stepDown,
  tierIndex,
  uploadKbps,
  TIERS,
  type QualityTier,
} from "./videoQuality";

export interface PlannerNode {
  id: string;
  /** Measured uplink, kbps. */
  uploadKbps: number;
  /** Measured encode budget, megapixels/second. */
  encodeMpxs: number;
  /** Seconds this node has been connected — a proxy for "won't vanish". */
  stableSeconds: number;
  /** Mobile/battery devices are never promoted to relay. */
  eligibleRelay: boolean;
}

export interface PlannerViewer extends PlannerNode {
  /** Tier this viewer actually needs, from its rendered tile size. */
  wantTier: QualityTier;
}

export interface PlanEdge {
  from: string;
  to: string;
  tier: QualityTier;
  depth: number;
}

export interface TopologyPlan {
  edges: PlanEdge[];
  /** 1 means plain mesh: nobody is relaying. */
  depth: number;
  /** Node ids that must relay to someone. Empty at depth 1. */
  relays: string[];
  /** How many tiers the whole room was knocked down to make it fit. */
  globalDowngrade: number;
  /** Viewers that could not be served at all, even at the worst tier. */
  unserved: string[];
  rootUploadKbps: number;
  rootEncodeMpxs: number;
}

// Never plan against 100% of a measured link or CPU: bandwidth estimates
// overshoot, and an encoder pinned at exactly its ceiling drops frames.
const UPLOAD_HEADROOM = 0.75;
const ENCODE_HEADROOM = 0.8;

// Hard cap on tree depth. Each hop adds ~120-220 ms and one re-encode
// generation; past three the picture is visibly degraded and the latency is
// no longer "live". Beyond this the planner degrades quality instead of
// deepening, which is the better trade.
const MAX_DEPTH = 3;

interface WorkNode extends PlannerNode {
  usedUploadKbps: number;
  usedEncodeMpxs: number;
  depth: number;
  served: boolean;
}

function freeUpload(n: WorkNode): number {
  return n.uploadKbps * UPLOAD_HEADROOM - n.usedUploadKbps;
}

function slotsFor(n: WorkNode, tier: QualityTier, multiplier: number): number {
  const perChildUp = uploadKbps(tier, multiplier);
  const perChildEnc = encodeMpxs(tier);
  if (perChildUp <= 0 || perChildEnc <= 0) return 0;
  const byUpload = Math.floor(freeUpload(n) / perChildUp);
  const byEncode = Math.floor((n.encodeMpxs * ENCODE_HEADROOM - n.usedEncodeMpxs) / perChildEnc);
  return Math.max(0, Math.min(byUpload, byEncode));
}

/**
 * Builds a delivery plan for one broadcaster.
 *
 * `contentMultiplier` must be the *measured* cost of the content (see
 * mediaStats), not a preset guess: the same "1080p60" label costs an eighth
 * as much for a static IDE as for a 60fps game, and planning against the
 * label is how a room ends up promising quality it cannot deliver.
 */
export function planTopology(
  root: PlannerNode,
  viewers: PlannerViewer[],
  contentMultiplier: number
): TopologyPlan {
  // Each downgrade level is a *fresh* allocation, not a continuation of the
  // previous one. Continuing was subtly wrong: the greedy pass would let the
  // first few viewers consume the entire budget at full quality, and then
  // dropping the room a tier freed nothing, because the capacity was already
  // spent. Everyone after them simply went unserved. Re-running from scratch
  // at the lower tier is what actually makes the room fit.
  let best: TopologyPlan | null = null;
  for (let downgrade = 0; downgrade < TIERS.length; downgrade += 1) {
    const attempt = allocate(root, viewers, contentMultiplier, downgrade);
    if (attempt.unserved.length === 0) return attempt;
    // Keep whichever attempt reaches the most people, in case even the
    // lowest tier cannot cover everyone.
    if (!best || attempt.edges.length > best.edges.length) best = attempt;
  }
  return best as TopologyPlan;
}

function allocate(
  root: PlannerNode,
  viewers: PlannerViewer[],
  contentMultiplier: number,
  globalDowngrade: number
): TopologyPlan {
  const nodes = new Map<string, WorkNode>();
  nodes.set(root.id, { ...root, usedUploadKbps: 0, usedEncodeMpxs: 0, depth: 0, served: true });
  for (const v of viewers) {
    nodes.set(v.id, { ...v, usedUploadKbps: 0, usedEncodeMpxs: 0, depth: -1, served: false });
  }

  const edges: PlanEdge[] = [];
  const wanted = new Map(viewers.map((v) => [v.id, v.wantTier]));
  // Most expensive first, so the strongest parent absorbs the fullscreen
  // viewers and relays are left with cheap grid tiles.
  const pending = [...viewers]
    .sort((a, b) => tierIndex(a.wantTier) - tierIndex(b.wantTier))
    .map((v) => v.id);

  while (pending.length > 0) {
    const parents = [...nodes.values()]
      .filter((n) => n.served && n.depth < MAX_DEPTH && (n.id === root.id || n.eligibleRelay))
      .sort(
        (a, b) =>
          freeUpload(b) - freeUpload(a) ||
          b.stableSeconds - a.stableSeconds ||
          b.encodeMpxs - a.encodeMpxs
      );

    let progressed = false;
    for (const parent of parents) {
      if (pending.length === 0) break;
      const childDepth = parent.depth + 1;
      if (childDepth > MAX_DEPTH) continue;

      let i = 0;
      while (i < pending.length) {
        const childId = pending[i];
        const child = nodes.get(childId);
        if (!child) {
          pending.splice(i, 1);
          continue;
        }
        // Deeper hops are served one tier lower. This is not a penalty: it
        // cuts the relay's upload and encode cost, limits how much quality
        // compounding re-encodes can destroy, and matches who actually ends
        // up deep in the tree (grid tiles, not fullscreen viewers).
        const tier = stepDown(wanted.get(childId) ?? "360p15", globalDowngrade + (childDepth - 1));
        if (slotsFor(parent, tier, contentMultiplier) < 1) {
          i += 1;
          continue;
        }
        parent.usedUploadKbps += uploadKbps(tier, contentMultiplier);
        parent.usedEncodeMpxs += encodeMpxs(tier);
        child.served = true;
        child.depth = childDepth;
        edges.push({ from: parent.id, to: childId, tier, depth: childDepth });
        pending.splice(i, 1);
        progressed = true;
      }
    }

    // Nothing more fits anywhere at this quality level. Stop; the caller
    // retries the whole allocation one tier lower, which is what keeps a weak
    // host from producing a plan that serves nobody — a 2-core laptop cannot
    // encode 1080p60 for anyone, and the right answer is that everybody
    // watches at 1080p30, not that a lucky few watch and the rest see nothing.
    if (!progressed) break;
  }

  const depth = edges.reduce((m, e) => Math.max(m, e.depth), 0);
  const relays = [...new Set(edges.filter((e) => e.depth > 1).map((e) => e.from))];
  const rootNode = nodes.get(root.id);

  return {
    edges,
    depth,
    relays,
    globalDowngrade,
    unserved: pending,
    rootUploadKbps: Math.round(rootNode?.usedUploadKbps ?? 0),
    rootEncodeMpxs: Math.round(rootNode?.usedEncodeMpxs ?? 0),
  };
}

/**
 * Cheap pre-check answering only "can the root serve everyone directly?".
 *
 * Run before planTopology on every peer-list change: when it returns true —
 * which, with per-viewer tiering, is the common case — the answer is plain
 * mesh and no plan needs building, no relay instructions need sending, and
 * nothing about the existing connections changes.
 */
export function fitsDirectMesh(
  root: PlannerNode,
  viewers: PlannerViewer[],
  contentMultiplier: number
): boolean {
  let up = 0;
  let enc = 0;
  for (const v of viewers) {
    up += uploadKbps(v.wantTier, contentMultiplier);
    enc += encodeMpxs(v.wantTier);
  }
  return up <= root.uploadKbps * UPLOAD_HEADROOM && enc <= root.encodeMpxs * ENCODE_HEADROOM;
}
