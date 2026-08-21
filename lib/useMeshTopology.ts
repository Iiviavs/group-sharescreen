"use client";

// Capacity exchange and topology decision.
//
// Everything here exists to answer one question as cheaply and as honestly as
// possible: *can the broadcaster serve this room directly?* If yes — which,
// once per-viewer tiering is in play, is the common case even at 30 people —
// nothing happens at all. No relays, no extra hops, no extra latency, no
// stranger's CPU being spent. Cascading is the fallback for when the answer
// is no, not the default shape of the room.
//
// Capacity is exchanged peer to peer over the existing signalling relay (the
// server forwards a signal's `data` opaquely), so none of this needs a
// backend change.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { signalingClient } from "./signalingClient";
import { encodeBudget, mediaStats, type CapacitySample } from "./mediaStats";
import {
  fitsDirectMesh,
  planTopology,
  type PlannerNode,
  type PlannerViewer,
  type TopologyPlan,
} from "./topologyPlanner";
import { encodeMpxs, type QualityTier } from "./videoQuality";

export interface PeerCapacity {
  peerId: string;
  uploadKbps: number;
  encodeMpxs: number;
  /** false for phones/tablets and anything on battery — never promoted. */
  eligibleRelay: boolean;
  /** This peer's own privacy preference: never route them through a relay. */
  directOnly: boolean;
  firstSeenAt: number;
  updatedAt: number;
}

// Devices we refuse to promote to relay regardless of their measured numbers.
// A phone can momentarily show a fine uplink and still be the worst possible
// choice: thermal throttling, metered data, and the fact that backgrounding
// the tab suspends everything the subtree below it depends on.
function isRelayEligible(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return false;
  const cores = navigator.hardwareConcurrency || 2;
  if (cores < 4) return false;
  const battery = (navigator as unknown as { getBattery?: unknown }).getBattery;
  // Presence of a battery API says nothing on its own; the charging check
  // happens asynchronously in useMeshCapacity and can veto later.
  void battery;
  return true;
}

const CAPACITY_BROADCAST_MS = 8000;

// Cascading only ever pays for itself in a room big enough that the
// alternative — everyone downgraded a tier or two to fit the broadcaster's
// own link — is worse than a relay hop's cost (a full decode+re-encode,
// ~120-220ms and a generation of quality loss, see relayLink.ts). Below this
// many people in the room, a broadcaster who can't reach everyone directly
// is degraded uniformly instead (see planTopology's downgrade loop) rather
// than routed through another participant's browser. Also used to skip the
// capacity broadcast below entirely in a small room: nothing there is ever
// read once cascading itself is off, so sending it would be pure background
// signalling traffic for no reason.
const CASCADE_ROOM_SIZE_THRESHOLD = 10;

/**
 * Measures this device's own serving capacity and keeps the room informed.
 *
 * The upload figure comes from ICE's own bandwidth estimate rather than a
 * synthetic probe: it is already being computed for congestion control, it
 * reflects the actual path to actual peers, and probing separately would
 * mean deliberately congesting the very link we are trying to measure.
 */
export function useMeshCapacity(directOnly: boolean = false) {
  const [capacity, setCapacity] = useState<CapacitySample>(() => mediaStats.getCapacity());
  const [relayEligible, setRelayEligible] = useState(() => isRelayEligible());
  const loadRef = useRef(0);

  useEffect(() => {
    const unsubscribe = mediaStats.onCapacity((sample) => {
      setCapacity(sample);
      // Feed observed CPU pressure back into the encode budget. This is the
      // only trustworthy signal available: hardwareConcurrency is a guess,
      // but "the encoder said it could not keep up" is ground truth.
      encodeBudget.observe(sample.cpuPressure, loadRef.current);
    });
    return unsubscribe;
  }, []);

  // A laptop on battery is technically capable and still a bad relay: the
  // extra encodes are a visible, unrequested drain on someone who only came
  // to watch.
  useEffect(() => {
    const nav = navigator as unknown as {
      getBattery?: () => Promise<{ charging: boolean; addEventListener: (e: string, f: () => void) => void }>;
    };
    if (!nav.getBattery) return;
    let cancelled = false;
    nav
      .getBattery()
      .then((b) => {
        const update = () => {
          if (!cancelled) setRelayEligible(isRelayEligible() && b.charging);
        };
        update();
        b.addEventListener("chargingchange", update);
      })
      .catch(() => {
        // Firefox and Safari do not expose this; the UA/core heuristics stand.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Current encode load, in Mpx/s, so the budget estimator can calibrate. */
  const reportLoad = useCallback((tiers: QualityTier[]) => {
    loadRef.current = tiers.reduce((sum, t) => sum + encodeMpxs(t), 0);
  }, []);

  const self = useMemo<PlannerNode>(
    () => ({
      id: signalingClient.state.selfId ?? "self",
      // Fall back to a deliberately modest assumption before the estimator
      // has produced anything: guessing high here would have the planner
      // promise a room more than the link can carry, and the first thing
      // anyone would notice is stuttering for everyone at once.
      uploadKbps: capacity.availableOutgoingKbps || 5000,
      encodeMpxs: encodeBudget.get(),
      stableSeconds: 0,
      eligibleRelay: relayEligible,
    }),
    [capacity.availableOutgoingKbps, relayEligible]
  );

  // Tell whoever is broadcasting what we could carry, so they can plan.
  //
  // Two things are deliberately narrow here. It is sent only to peers who are
  // actually sharing — they are the only ones who could ever need to plan a
  // tree — rather than to the whole room, which would be N² messages every
  // interval for information nobody else reads. And it runs whenever *someone
  // else* is sharing, not when we are: the party with something to report is
  // the potential relay, which is precisely the viewer.
  useEffect(() => {
    const broadcast = () => {
      const nonModeratorPeers = signalingClient.state.peers.filter((p) => p.role !== "moderator");
      // Below CASCADE_ROOM_SIZE_THRESHOLD, useMeshTopology never builds a
      // plan that could use this — see its own doc comment.
      if (nonModeratorPeers.length + 1 <= CASCADE_ROOM_SIZE_THRESHOLD) return;
      const broadcasters = nonModeratorPeers.filter((p) => p.sharing);
      if (broadcasters.length === 0) return;
      for (const peer of broadcasters) {
        signalingClient.sendSignal(peer.id, {
          channel: "screen",
          role: "viewer",
          kind: "capacity",
          uploadKbps: self.uploadKbps,
          encodeMpxs: self.encodeMpxs,
          eligibleRelay: self.eligibleRelay,
          directOnly,
        });
      }
    };
    broadcast();
    const timer = setInterval(broadcast, CAPACITY_BROADCAST_MS);
    return () => clearInterval(timer);
  }, [self, directOnly]);

  return { capacity, self, relayEligible, reportLoad };
}

export interface TopologyAdvice {
  /** True when the root can serve everyone directly — the desired state. */
  directMeshFits: boolean;
  plan: TopologyPlan | null;
  /** Human-readable reason the cascade engaged, or null when it has not. */
  reason: string | null;
}

// Re-planning is not free and, more importantly, acting on a new plan means
// tearing down and rebuilding real connections. Only re-plan when the inputs
// have actually moved, and never faster than this.
const REPLAN_COOLDOWN_MS = 6000;

/**
 * Decides whether the current room needs a cascade, and if so, what shape.
 *
 * Deliberately returns *advice*, not side effects. Nothing here opens or
 * closes a connection: the caller applies the plan (or, in the common case,
 * discovers there is nothing to apply and carries on with plain mesh).
 */
export function useMeshTopology(
  active: boolean,
  selfRef: { current: PlannerNode },
  // Getters rather than values: these maps are mutated on the signalling hot
  // path (a capacity message every few seconds per peer, a quality request on
  // every tile resize). Feeding them through React state would re-render the
  // whole room on each one. Evaluating on a timer instead keeps the cost off
  // the render path entirely, and topology simply does not need to react
  // within a frame.
  getPeerCapacities: () => Map<string, PeerCapacity>,
  getRequestedTiers: () => Map<string, QualityTier>,
  getContentMultiplier: () => number
): TopologyAdvice {
  const [advice, setAdvice] = useState<TopologyAdvice>({
    directMeshFits: true,
    plan: null,
    reason: null,
  });

  useEffect(() => {
    // Everything, including the idle reset, runs off the render path. The
    // updater form is also load-bearing: it returns the previous object
    // unchanged when nothing meaningful moved, so a room sitting comfortably
    // in direct mesh re-renders nobody, every six seconds, forever.
    const idle = () =>
      setAdvice((prev) =>
        prev.directMeshFits && !prev.plan ? prev : { directMeshFits: true, plan: null, reason: null }
      );
    if (!active) {
      const t = setTimeout(idle, 0);
      return () => clearTimeout(t);
    }
    const evaluate = () => {
    const now = Date.now();
    const self = selfRef.current;
    const peerCapacities = getPeerCapacities();
    const requestedTiers = getRequestedTiers();
    const contentMultiplier = getContentMultiplier();

    const viewers: PlannerViewer[] = signalingClient.state.peers
      .filter((p) => p.role !== "moderator")
      .map((p) => {
        const cap = peerCapacities.get(p.id);
        return {
          id: p.id,
          uploadKbps: cap?.uploadKbps ?? 0,
          encodeMpxs: cap?.encodeMpxs ?? 0,
          stableSeconds: cap ? Math.round((now - cap.firstSeenAt) / 1000) : 0,
          // A peer we have never heard capacity from cannot be trusted to
          // relay; silence is not evidence of capability.
          eligibleRelay: cap?.eligibleRelay ?? false,
          wantTier: requestedTiers.get(p.id) ?? "720p30",
          directOnly: cap?.directOnly ?? false,
        };
      });

    if (viewers.length === 0) {
      setAdvice((prev) => (prev.directMeshFits && !prev.plan ? prev : { directMeshFits: true, plan: null, reason: null }));
      return;
    }

    // The cheap path, and the one that should normally win: if the root can
    // reach everyone directly there is no plan to build and nothing to change.
    if (fitsDirectMesh(self, viewers, contentMultiplier)) {
      setAdvice((prev) => (prev.directMeshFits && !prev.plan ? prev : { directMeshFits: true, plan: null, reason: null }));
      return;
    }

    // Below the threshold, nobody is eligible to relay — the planner falls
    // back to its uniform-downgrade path on its own (the same one it already
    // uses for peers it has no capacity report from at all), so this needs
    // no other change here.
    const roomSize = viewers.length + 1;
    const plannerViewers =
      roomSize > CASCADE_ROOM_SIZE_THRESHOLD
        ? viewers
        : viewers.map((v) => (v.eligibleRelay ? { ...v, eligibleRelay: false } : v));

    const plan = planTopology(self, plannerViewers, contentMultiplier);
    const reason =
      plan.depth > 1
        ? `Sua conexão não alcança ${viewers.length} pessoas sozinha — ${plan.relays.length} participante(s) estão ajudando a retransmitir.`
        : plan.globalDowngrade > 0
          ? "Qualidade reduzida para caber na sua conexão."
          : null;
      setAdvice({ directMeshFits: false, plan, reason });
    };

    // Deliberately not evaluated synchronously here. At the instant a share
    // starts no capacity reports have arrived yet, so an immediate pass would
    // plan against an empty picture and could briefly claim the room does not
    // fit. Letting the first pass land a moment later also keeps this off the
    // render path, which is what the setState-in-effect rule is protecting.
    const first = setTimeout(evaluate, 1500);
    const timer = setInterval(evaluate, REPLAN_COOLDOWN_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [active, selfRef, getPeerCapacities, getRequestedTiers, getContentMultiplier]);

  return advice;
}
