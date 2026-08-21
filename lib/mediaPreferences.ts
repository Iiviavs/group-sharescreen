// Local, device-only UI preferences for the room controls — persisted so a
// returning visitor's mic/noise-suppression/mute setup carries over instead
// of resetting to defaults on every reload.

const NOISE_SUPPRESSION_KEY = "sharescreen:noiseSuppressionOn";
const MIC_ON_KEY = "sharescreen:micOn";
const MICS_MUTED_KEY = "sharescreen:micsMuted";
const FORCE_RELAY_ICE_KEY = "sharescreen:forceRelayIce";

function getStoredBoolean(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : raw === "true";
  } catch {
    return fallback;
  }
}

function setStoredBoolean(key: string, value: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // ignored - localStorage may be unavailable (private mode, quota, etc.)
  }
}

export function getStoredNoiseSuppressionOn(): boolean {
  return getStoredBoolean(NOISE_SUPPRESSION_KEY, true);
}
export function setStoredNoiseSuppressionOn(value: boolean) {
  setStoredBoolean(NOISE_SUPPRESSION_KEY, value);
}

// The mic's own on/off state — restored by auto-starting the mic once on
// mount (and again after a room switch) when this was last true, same as
// how a returning visitor's noise-suppression/mute choices come back.
export function getStoredMicOn(): boolean {
  return getStoredBoolean(MIC_ON_KEY, false);
}
export function setStoredMicOn(value: boolean) {
  setStoredBoolean(MIC_ON_KEY, value);
}

export function getStoredMicsMuted(): boolean {
  return getStoredBoolean(MICS_MUTED_KEY, false);
}
export function setStoredMicsMuted(value: boolean) {
  setStoredBoolean(MICS_MUTED_KEY, value);
}

// "Impedir conexões diretas": forces every peer connection this client makes
// (sending or receiving, any channel) through the TURN relay instead of
// negotiating direct P2P — our own host/srflx candidates are gathered but
// never offered to the other side, so they only ever learn our TURN
// server's address, never ours. See lib/iceConfig.ts's iceConfigFor. Off by
// default: it costs latency and, on a slow TURN server, quality too.
export function getStoredForceRelayIce(): boolean {
  return getStoredBoolean(FORCE_RELAY_ICE_KEY, false);
}
export function setStoredForceRelayIce(value: boolean) {
  setStoredBoolean(FORCE_RELAY_ICE_KEY, value);
}

// Per-peer volume dials (mic "speaking" volume, and a shared screen/camera
// "transmission" volume) — the caller keys these by PeerInfo.userId (a
// stable per-account/per-guest id from the server, constant across that
// person's reconnects/reloads), falling back to their connection id only
// for a peer an older server hasn't sent one for yet. Capped like
// hidden-announcement ids so a long history of past peers doesn't grow this
// forever.
const PEER_VOLUMES_KEY = "sharescreen:peerVolumes";
const TRANSMISSION_VOLUMES_KEY = "sharescreen:transmissionVolumes";
const MAX_STORED_VOLUMES = 50;

function getStoredVolumes(key: string): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, number>;
  } catch {
    return {};
  }
}

function setStoredVolume(key: string, peerId: string, volume: number) {
  if (typeof window === "undefined") return;
  try {
    const current = getStoredVolumes(key);
    // Delete-then-set moves this id to the end, so trimming below drops the
    // least-recently-touched entries first instead of an arbitrary one.
    delete current[peerId];
    current[peerId] = volume;
    const entries = Object.entries(current);
    const trimmed =
      entries.length > MAX_STORED_VOLUMES ? entries.slice(entries.length - MAX_STORED_VOLUMES) : entries;
    window.localStorage.setItem(key, JSON.stringify(Object.fromEntries(trimmed)));
  } catch {
    // ignored - localStorage may be unavailable (private mode, quota, etc.)
  }
}

export function getStoredPeerVolumes(): Record<string, number> {
  return getStoredVolumes(PEER_VOLUMES_KEY);
}
export function setStoredPeerVolume(peerId: string, volume: number) {
  setStoredVolume(PEER_VOLUMES_KEY, peerId, volume);
}

export function getStoredTransmissionVolumes(): Record<string, number> {
  return getStoredVolumes(TRANSMISSION_VOLUMES_KEY);
}
export function setStoredTransmissionVolume(peerId: string, volume: number) {
  setStoredVolume(TRANSMISSION_VOLUMES_KEY, peerId, volume);
}
