// Per-peer sender quality control.
//
// Two inputs decide what one viewer receives, and keeping them separate is
// the whole point of this module:
//
//   1. the assigned tier — what this viewer actually *needs*, driven by the
//      size their tile is rendered at (see videoQuality.tierForRenderedSize)
//      and by the topology plan;
//   2. the congestion ratio — how much of that tier their link can currently
//      carry, learned from their own loss/RTT reports.
//
// The previous implementation conflated the two: every time the room's peer
// count changed, the quality effect re-applied the base bitrate to *every*
// sender and restarted each congestion monitor from scratch. A viewer on a
// bad link that had correctly settled at 800 kbps was slammed back to full
// bitrate every single time anyone joined or left, then had to spend another
// ~6 seconds per step walking back down. In a room with any churn it never
// converged at all.
//
// Here, setTier() changes (1) and deliberately leaves (2) untouched, so hard
// won knowledge about a viewer's link survives an unrelated room change.

import { mediaStats, type SenderSample } from "./mediaStats";
import {
  congestedBitrateKbps,
  scaleFactorFor,
  tierSpec,
  uploadKbps,
  type QualityTier,
} from "./videoQuality";

export type DegradationMode = "text" | "motion";

// Congestion thresholds. Deliberately asymmetric: back off faster than we
// recover, because oscillating between bitrates looks far worse to a viewer
// than sitting slightly below the ceiling for a bit. But the ratio now
// survives room churn (see setTier's comment), which makes it a permanent
// scar rather than a transient dip — so a single noisy sample (one dropped
// ack, a brief wifi retransmit, a GC pause) can no longer cut bitrate on its
// own; it takes BAD_STREAK_TO_BACKOFF consecutive bad samples, same as
// recovery already requires a streak of good ones. Backoff and recovery
// steps are also both gentler than they used to be, and the floor is higher,
// so genuine congestion settles at a still-watchable bitrate instead of
// ratcheting all the way down toward an unusable one.
const LOSS_BAD = 0.04;
const RTT_BAD = 0.35;
const LOSS_GOOD = 0.01;
const RTT_GOOD = 0.2;
const BACKOFF = 0.85;
const RECOVER = 1.2;
const BAD_STREAK_TO_BACKOFF = 2;
const HEALTHY_STREAK_TO_RECOVER = 2;
const MIN_RATIO = 0.4;

// Below this share of the tier's bitrate, extra spatial downscaling buys the
// encoder headroom — half resolution encoded well beats full resolution
// encoded into mush.
//
// These are shares of the tier, not absolute bitrates, and that difference
// matters: judging by absolute kbps (as the previous implementation did)
// meant a deliberately cheap 360p tier was permanently treated as congested
// and downscaled, simply because its healthy bitrate is a small number.
const SCALE_HARD = 0.4;
const SCALE_SOFT = 0.65;

export class PeerQualityController {
  private ratio = 1;
  private healthyStreak = 0;
  private badStreak = 0;
  private appliedKbps = 0;
  private appliedScale = 0;
  private disposed = false;

  constructor(
    readonly peerId: string,
    private sender: RTCRtpSender,
    private tier: QualityTier,
    private captureHeight: number,
    private contentMultiplier: number,
    private degradation: DegradationMode
  ) {}

  /**
   * Assign a new tier (tile resized, topology changed, dial moved).
   * Congestion state is intentionally preserved across this call.
   */
  setTier(tier: QualityTier) {
    if (this.tier === tier) return;
    this.tier = tier;
    mediaStats.setTier(this.peerId, tier);
    this.apply();
  }

  setCaptureHeight(height: number) {
    if (!height || this.captureHeight === height) return;
    this.captureHeight = height;
    this.apply();
  }

  setContentMultiplier(multiplier: number) {
    // Only react to meaningful moves; this value is smoothed upstream but
    // still wanders, and setParameters is not free.
    if (Math.abs(multiplier - this.contentMultiplier) < 0.1) return;
    this.contentMultiplier = multiplier;
    this.apply();
  }

  setDegradation(mode: DegradationMode) {
    if (this.degradation === mode) return;
    this.degradation = mode;
    this.apply();
  }

  getTier(): QualityTier {
    return this.tier;
  }

  /** Feed one telemetry sample for this peer. */
  onSample(sample: SenderSample) {
    if (this.disposed) return;
    const { fractionLost, rtt } = sample;
    if (fractionLost > LOSS_BAD || rtt > RTT_BAD) {
      this.healthyStreak = 0;
      this.badStreak += 1;
      if (this.badStreak >= BAD_STREAK_TO_BACKOFF) {
        this.badStreak = 0;
        this.ratio = Math.max(MIN_RATIO, this.ratio * BACKOFF);
        this.apply();
      }
    } else if (fractionLost <= LOSS_GOOD && rtt < RTT_GOOD) {
      this.badStreak = 0;
      this.healthyStreak += 1;
      if (this.healthyStreak >= HEALTHY_STREAK_TO_RECOVER && this.ratio < 1) {
        this.ratio = Math.min(1, this.ratio * RECOVER);
        this.healthyStreak = 0;
        this.apply();
      }
    } else {
      // Neither clearly bad nor clearly good: hold, and require a fresh
      // clean run before allowing either a backoff or a recovery.
      this.healthyStreak = 0;
      this.badStreak = 0;
    }
  }

  /** Pushes the current target onto the sender, if it actually changed. */
  apply() {
    if (this.disposed) return;
    const tierKbps = uploadKbps(this.tier, this.contentMultiplier);
    const targetKbps = congestedBitrateKbps(tierKbps, this.ratio);
    const tierScale = scaleFactorFor(this.tier, this.captureHeight);
    const congestionScale =
      this.ratio <= SCALE_HARD ? 2 : this.ratio <= SCALE_SOFT ? 1.5 : 1;
    const scale = Math.round(tierScale * congestionScale * 100) / 100;

    // setParameters triggers an encoder reconfiguration; calling it with
    // values that did not change costs a keyframe and a visible hitch for
    // no benefit. In a 30-peer room this guard removes the large majority
    // of calls, since most peers are steady most of the time.
    if (
      Math.abs(targetKbps - this.appliedKbps) < Math.max(50, this.appliedKbps * 0.05) &&
      scale === this.appliedScale
    ) {
      return;
    }
    this.appliedKbps = targetKbps;
    this.appliedScale = scale;

    let params: RTCRtpSendParameters;
    try {
      params = this.sender.getParameters();
    } catch {
      return;
    }
    const encodings =
      params.encodings && params.encodings.length > 0 ? params.encodings : [{} as RTCRtpEncodingParameters];
    encodings[0].maxBitrate = targetKbps * 1000;
    encodings[0].scaleResolutionDownBy = scale;
    encodings[0].maxFramerate = tierSpec(this.tier).frameRate;
    params.encodings = encodings;
    // "text" keeps the picture sharp and lets frame rate fall — right for
    // code and documents. "motion" does the opposite, which is what a 60fps
    // game or video needs. Choosing wrong is not subtle: a 60fps share under
    // maintain-resolution degrades into a slideshow rather than softening.
    params.degradationPreference =
      this.degradation === "text" ? "maintain-resolution" : "maintain-framerate";
    this.sender.setParameters(params).catch(() => {
      // Racing a renegotiation or a closing pc — the next apply() will
      // reconcile, so a failure here is not worth surfacing.
    });
  }

  dispose() {
    this.disposed = true;
  }
}

/**
 * Owns every live controller for one media channel and wires them to the
 * single shared stats pump.
 */
export class PeerQualityRegistry {
  private controllers = new Map<string, PeerQualityController>();
  private unsubscribeSender: (() => void) | null = null;
  private unsubscribeCapacity: (() => void) | null = null;
  private contentMultiplier = 1;
  private degradation: DegradationMode = "text";

  start() {
    if (this.unsubscribeSender) return;
    this.unsubscribeSender = mediaStats.onSender((sample) => {
      this.controllers.get(sample.peerId)?.onSample(sample);
    });
    this.unsubscribeCapacity = mediaStats.onCapacity((cap) => {
      this.contentMultiplier = cap.contentMultiplier;
      for (const c of this.controllers.values()) c.setContentMultiplier(cap.contentMultiplier);
    });
  }

  add(
    peerId: string,
    pc: RTCPeerConnection,
    sender: RTCRtpSender,
    tier: QualityTier,
    captureHeight: number
  ): PeerQualityController {
    this.remove(peerId);
    const controller = new PeerQualityController(
      peerId,
      sender,
      tier,
      captureHeight,
      this.contentMultiplier,
      this.degradation
    );
    this.controllers.set(peerId, controller);
    mediaStats.register(peerId, pc, sender, tier);
    controller.apply();
    this.start();
    return controller;
  }

  get(peerId: string): PeerQualityController | undefined {
    return this.controllers.get(peerId);
  }

  remove(peerId: string) {
    this.controllers.get(peerId)?.dispose();
    this.controllers.delete(peerId);
    mediaStats.unregister(peerId);
  }

  setDegradation(mode: DegradationMode) {
    this.degradation = mode;
    for (const c of this.controllers.values()) c.setDegradation(mode);
  }

  setCaptureHeight(height: number) {
    for (const c of this.controllers.values()) c.setCaptureHeight(height);
  }

  clear() {
    for (const peerId of [...this.controllers.keys()]) this.remove(peerId);
    this.unsubscribeSender?.();
    this.unsubscribeCapacity?.();
    this.unsubscribeSender = null;
    this.unsubscribeCapacity = null;
  }
}
