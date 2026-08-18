"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { signalingClient } from "./signalingClient";
import { trackEvent } from "./analytics";
import { ICE_CONFIG } from "./iceConfig";
import { captureNoiseSuppressedMic, setGraphSuppressionEnabled, type MicNoiseGraph } from "./rnnoise";

type Channel = "screen" | "mic";
type ShareSource = "display" | "camera";

type SignalData = {
  channel?: Channel;
  role?: "broadcaster" | "viewer";
  kind?: "offer" | "answer" | "ice" | "stop" | "peer-left";
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};

// Mesh P2P means whoever shares their screen uploads one full encode per
// viewer (see AGENTS.md-adjacent discussion in useRoomMedia's callers) — in
// a big room that upload is often the actual bottleneck, so letting the
// broadcaster trade resolution/fps/bitrate down independently is the one
// lever that helps without a server-side media relay.
export type ShareResolution = "1080p" | "720p" | "480p" | "360p";
export type ShareFps = 15 | 24 | 30 | 60;
export type ShareBitrate = "low" | "medium" | "high";

type QualityPreset = {
  width: number;
  height: number;
  frameRate: number;
  maxBitrateKbps: number;
};

const RESOLUTION_DIMENSIONS: Record<ShareResolution, { width: number; height: number }> = {
  "1080p": { width: 1920, height: 1080 },
  "720p": { width: 1280, height: 720 },
  "480p": { width: 854, height: 480 },
  "360p": { width: 640, height: 360 },
};

const BITRATE_KBPS: Record<ShareBitrate, number> = {
  low: 700,
  medium: 2000,
  high: 4000,
};

export const SHARE_RESOLUTION_OPTIONS: { value: ShareResolution; label: string }[] = [
  { value: "1080p", label: "1080p" },
  { value: "720p", label: "720p" },
  { value: "480p", label: "480p" },
  { value: "360p", label: "360p" },
];

export const SHARE_FPS_OPTIONS: { value: ShareFps; label: string }[] = [
  { value: 15, label: "15 fps" },
  { value: 24, label: "24 fps" },
  { value: 30, label: "30 fps" },
  { value: 60, label: "60 fps" },
];

export const SHARE_BITRATE_OPTIONS: { value: ShareBitrate; label: string }[] = [
  { value: "low", label: "Bitrate baixo (~700 kbps)" },
  { value: "medium", label: "Bitrate médio (~2 Mbps)" },
  { value: "high", label: "Bitrate alto (~4 Mbps)" },
];

function applySenderBitrate(sender: RTCRtpSender, maxBitrateKbps: number | undefined) {
  if (!maxBitrateKbps) return;
  const params = sender.getParameters();
  const encodings = params.encodings && params.encodings.length > 0 ? params.encodings : [{}];
  encodings[0].maxBitrate = maxBitrateKbps * 1000;
  params.encodings = encodings;
  sender.setParameters(params).catch(() => {});
}

// Shared connection-management for a single media channel (screen share or
// mic), broadcast from this client to every peer in the room. Each channel
// gets its own set of peer connections and its own signaling namespace so
// screen-share and mic negotiation never interfere with each other.
function useBroadcastChannel(
  channel: Channel,
  room: string,
  capture: (source?: ShareSource) => Promise<MediaStream>,
  isSupported: () => boolean,
  notSupportedMessage: string,
  failureMessage: string,
  // Only meaningful for the screen channel — mic never passes this. When it
  // changes while a share is already active, the live track and every
  // current sender get updated in place instead of requiring a restart.
  videoQuality?: QualityPreset
) {
  const eventPrefix = channel === "screen" ? "screen_share" : "mic";
  const [active, setActive] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<ShareSource | undefined>(undefined);
  const localStreamRef = useRef<MediaStream | null>(null);
  const sendPCs = useRef<Map<string, RTCPeerConnection>>(new Map());
  const recvPCs = useRef<Map<string, RTCPeerConnection>>(new Map());
  const activeRef = useRef(false);
  const pendingSendCandidates = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const pendingRecvCandidates = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const videoQualityRef = useRef(videoQuality);
  useEffect(() => {
    videoQualityRef.current = videoQuality;
  }, [videoQuality]);

  const removeRemoteStream = useCallback((peerId: string) => {
    setRemoteStreams((prev) => {
      if (!(peerId in prev)) return prev;
      const next = { ...prev };
      delete next[peerId];
      return next;
    });
  }, []);

  const closeSendPC = useCallback((peerId: string) => {
    const pc = sendPCs.current.get(peerId);
    if (pc) {
      pc.close();
      sendPCs.current.delete(peerId);
    }
    pendingSendCandidates.current.delete(peerId);
  }, []);

  const closeRecvPC = useCallback(
    (peerId: string) => {
      const pc = recvPCs.current.get(peerId);
      if (pc) {
        pc.close();
        recvPCs.current.delete(peerId);
      }
      pendingRecvCandidates.current.delete(peerId);
      removeRemoteStream(peerId);
    },
    [removeRemoteStream]
  );

  const openSendPCRef = useRef<(peerId: string) => void>(() => {});

  const scheduleSendRetry = useCallback((peerId: string) => {
    // A P2P link can die from a transient network blip (wifi/cell handoff,
    // brief packet loss, TURN hiccup) without the peer actually leaving the
    // room. Nothing else would ever re-offer, so without this retry the
    // tile just stays dead forever.
    setTimeout(() => {
      if (activeRef.current && signalingClient.state.peers.some((p) => p.id === peerId)) {
        openSendPCRef.current(peerId);
      }
    }, 2000);
  }, []);

  const openSendPC = useCallback(
    (peerId: string) => {
      if (sendPCs.current.has(peerId) || !localStreamRef.current) return;
      const stream = localStreamRef.current;
      const pc = new RTCPeerConnection(ICE_CONFIG);
      sendPCs.current.set(peerId, pc);
      stream.getTracks().forEach((track) => {
        const sender = pc.addTrack(track, stream);
        if (track.kind === "video") applySenderBitrate(sender, videoQualityRef.current?.maxBitrateKbps);
      });
      pc.onicecandidate = (e) => {
        if (e.candidate) {
          signalingClient.sendSignal(peerId, {
            channel,
            role: "broadcaster",
            kind: "ice",
            candidate: e.candidate.toJSON(),
          });
        }
      };
      pc.onconnectionstatechange = () => {
        // Ignore events from a pc that's already been superseded (e.g. a
        // retry already replaced it) — otherwise this stale callback could
        // tear down the new connection instead of the dead one.
        if (sendPCs.current.get(peerId) !== pc) return;
        if (pc.connectionState === "failed") {
          closeSendPC(peerId);
          scheduleSendRetry(peerId);
        } else if (pc.connectionState === "disconnected") {
          // Some browsers (notably mobile Safari) can sit in "disconnected"
          // for a long time instead of ever declaring "failed", even though
          // the link is actually dead — which left the tile frozen
          // indefinitely instead of retrying. Give it a few seconds to
          // recover on its own from a brief blip first.
          setTimeout(() => {
            if (sendPCs.current.get(peerId) === pc && pc.connectionState === "disconnected") {
              closeSendPC(peerId);
              scheduleSendRetry(peerId);
            }
          }, 4000);
        } else if (pc.connectionState === "closed") {
          closeSendPC(peerId);
        }
      };
      pc.createOffer()
        .then(async (offer) => {
          if (sendPCs.current.get(peerId) !== pc) return;
          await pc.setLocalDescription(offer);
          if (sendPCs.current.get(peerId) !== pc) return;
          signalingClient.sendSignal(peerId, {
            channel,
            role: "broadcaster",
            kind: "offer",
            sdp: pc.localDescription,
          });
        })
        .catch(() => {
          // Offer creation/negotiation can fail outright (not just go
          // "failed" after connecting) — e.g. a dropped signaling message.
          // Without a retry here the peer's "sharing" indicator stays on
          // forever with no video ever arriving, since nothing else re-runs
          // openSendPC until the peer list itself changes.
          if (sendPCs.current.get(peerId) !== pc) return;
          closeSendPC(peerId);
          scheduleSendRetry(peerId);
        });
    },
    [channel, closeSendPC, scheduleSendRetry]
  );

  useEffect(() => {
    openSendPCRef.current = openSendPC;
  }, [openSendPC]);

  // Lets the broadcaster change resolution/fps/bitrate mid-share to react to
  // a room bogging down, instead of having to stop and restart the whole
  // capture. Skipped while inactive — a change picked before starting is
  // simply read fresh by `capture` (via videoQualityRef-equivalent state in
  // the caller) the next time start() runs.
  useEffect(() => {
    if (!videoQuality || !activeRef.current || !localStreamRef.current) return;
    const track = localStreamRef.current.getVideoTracks()[0];
    track
      ?.applyConstraints({
        width: { ideal: videoQuality.width },
        height: { ideal: videoQuality.height },
        frameRate: { ideal: videoQuality.frameRate },
      })
      .catch(() => {});
    for (const pc of sendPCs.current.values()) {
      const sender = pc.getSenders().find((s) => s.track?.kind === "video");
      if (sender) applySenderBitrate(sender, videoQuality.maxBitrateKbps);
    }
  }, [videoQuality]);

  const stop = useCallback(() => {
    if (!activeRef.current) return;
    activeRef.current = false;
    setActive(false);
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    setLocalStream(null);
    setSource(undefined);
    for (const [peerId, pc] of sendPCs.current) {
      signalingClient.sendSignal(peerId, { channel, role: "broadcaster", kind: "stop" });
      pc.close();
    }
    sendPCs.current.clear();
    if (channel === "screen") signalingClient.setSharing(false);
    else signalingClient.setMic(false);
    trackEvent(`${eventPrefix}_stop`);
  }, [channel, eventPrefix]);

  const start = useCallback(async (requestedSource?: ShareSource) => {
    if (activeRef.current) return;
    setError(null);
    if (!isSupported()) {
      setError(notSupportedMessage);
      return;
    }
    try {
      const stream = await capture(requestedSource);
      localStreamRef.current = stream;
      activeRef.current = true;
      setLocalStream(stream);
      setActive(true);
      setSource(requestedSource);
      if (channel === "screen") signalingClient.setSharing(true);
      else signalingClient.setMic(true);
      trackEvent(`${eventPrefix}_start`);
      stream.getTracks().forEach((track) => track.addEventListener("ended", () => stop()));
      for (const peer of signalingClient.state.peers) {
        openSendPC(peer.id);
      }
    } catch {
      setError(failureMessage);
      trackEvent(`${eventPrefix}_error`);
    }
  }, [
    capture,
    isSupported,
    notSupportedMessage,
    failureMessage,
    channel,
    eventPrefix,
    openSendPC,
    stop,
  ]);

  const openRecvPC = useCallback(
    (peerId: string) => {
      const pc = new RTCPeerConnection(ICE_CONFIG);
      recvPCs.current.set(peerId, pc);
      pc.ontrack = (e) => {
        setRemoteStreams((prev) => ({ ...prev, [peerId]: e.streams[0] }));
      };
      pc.onicecandidate = (e) => {
        if (e.candidate) {
          signalingClient.sendSignal(peerId, {
            channel,
            role: "viewer",
            kind: "ice",
            candidate: e.candidate.toJSON(),
          });
        }
      };
      pc.onconnectionstatechange = () => {
        if (recvPCs.current.get(peerId) !== pc) return;
        if (pc.connectionState === "failed" || pc.connectionState === "closed") {
          closeRecvPC(peerId);
        } else if (pc.connectionState === "disconnected") {
          // Mirrors the sender-side grace period: don't tear down a viewer's
          // tile over a brief blip, but don't let it sit frozen forever
          // either if the link doesn't recover. The broadcaster's own
          // sendPC (see openSendPC above) mirrors this same link, so once
          // its side also gives up it sends a fresh offer that rebuilds
          // this from scratch.
          setTimeout(() => {
            if (recvPCs.current.get(peerId) === pc && pc.connectionState === "disconnected") {
              closeRecvPC(peerId);
            }
          }, 4000);
        }
      };
      return pc;
    },
    [channel, closeRecvPC]
  );

  useEffect(() => {
    const unsubscribeSignal = signalingClient.onSignal((from, rawData) => {
      const data = rawData as SignalData;
      if (data.kind === "peer-left") {
        closeSendPC(from);
        closeRecvPC(from);
        return;
      }
      if (data.channel !== channel) return;
      if (data.role === "broadcaster") {
        if (data.kind === "offer" && data.sdp) {
          // A fresh offer always comes from a brand-new RTCPeerConnection on
          // the sender's side (this app never renegotiates an existing one
          // in place, including on the failure-triggered retry above) — if
          // we still have a pc for this peer, it belongs to a superseded
          // session. Reusing it here would feed unrelated SDP into it
          // instead of cleanly replacing the connection, which can leave
          // two live tracks feeding the same rendered stream (duplicated,
          // echoing audio) rather than one.
          if (recvPCs.current.has(from)) closeRecvPC(from);
          const thisPc = openRecvPC(from);
          thisPc
            .setRemoteDescription(data.sdp)
            .then(async () => {
              if (recvPCs.current.get(from) !== thisPc) return null;
              const queued = pendingRecvCandidates.current.get(from);
              if (queued) {
                pendingRecvCandidates.current.delete(from);
                for (const candidate of queued) {
                  await thisPc.addIceCandidate(candidate).catch(() => {});
                }
              }
              return thisPc.createAnswer();
            })
            .then((answer) => {
              if (!answer || recvPCs.current.get(from) !== thisPc) return;
              return thisPc.setLocalDescription(answer);
            })
            .then(() => {
              if (recvPCs.current.get(from) !== thisPc) return;
              signalingClient.sendSignal(from, {
                channel,
                role: "viewer",
                kind: "answer",
                sdp: thisPc.localDescription,
              });
            })
            .catch(() => {
              if (recvPCs.current.get(from) === thisPc) closeRecvPC(from);
            });
        } else if (data.kind === "ice" && data.candidate) {
          const pc = recvPCs.current.get(from);
          if (pc && pc.remoteDescription) {
            pc.addIceCandidate(data.candidate).catch(() => {});
          } else {
            const queue = pendingRecvCandidates.current.get(from) ?? [];
            queue.push(data.candidate);
            pendingRecvCandidates.current.set(from, queue);
          }
        } else if (data.kind === "stop") {
          closeRecvPC(from);
        }
      } else if (data.role === "viewer") {
        if (data.kind === "answer" && data.sdp) {
          const pc = sendPCs.current.get(from);
          pc?.setRemoteDescription(data.sdp)
            .then(async () => {
              const queued = pendingSendCandidates.current.get(from);
              if (queued) {
                pendingSendCandidates.current.delete(from);
                for (const candidate of queued) {
                  await pc.addIceCandidate(candidate).catch(() => {});
                }
              }
            })
            .catch(() => {});
        } else if (data.kind === "ice" && data.candidate) {
          const pc = sendPCs.current.get(from);
          if (pc && pc.remoteDescription) {
            pc.addIceCandidate(data.candidate).catch(() => {});
          } else {
            const queue = pendingSendCandidates.current.get(from) ?? [];
            queue.push(data.candidate);
            pendingSendCandidates.current.set(from, queue);
          }
        }
      }
    });

    const unsubscribeState = signalingClient.subscribe(() => {
      if (activeRef.current) {
        for (const peer of signalingClient.state.peers) {
          if (!sendPCs.current.has(peer.id)) openSendPC(peer.id);
        }
      }
    });

    const unsubscribeRoomJoined = signalingClient.onRoomJoined(() => {
      // Our own signaling socket reconnecting replaces the whole peer list
      // at once instead of emitting individual peer-left events — so if
      // someone actually left the room while we were briefly disconnected,
      // nothing else would ever tell us. Without this, their connection and
      // video/audio tile would linger as a permanent ghost. Stable
      // client ids (see signalingClient) mean everyone who's still around
      // keeps the same id, so this only prunes genuinely departed peers.
      const currentIds = new Set(signalingClient.state.peers.map((p) => p.id));
      for (const peerId of [...sendPCs.current.keys()]) {
        if (!currentIds.has(peerId)) closeSendPC(peerId);
      }
      for (const peerId of [...recvPCs.current.keys()]) {
        if (!currentIds.has(peerId)) closeRecvPC(peerId);
      }

      // The server has a fresh entry with sharing/mic reset to false —
      // re-announce our actual state so other peers' indicators don't go
      // stale.
      if (!activeRef.current) return;
      if (channel === "screen") signalingClient.setSharing(true);
      else signalingClient.setMic(true);
    });

    return () => {
      unsubscribeSignal();
      unsubscribeState();
      unsubscribeRoomJoined();
    };
  }, [channel, openRecvPC, openSendPC, closeSendPC, closeRecvPC]);

  useEffect(() => {
    const pcs = recvPCs.current;
    return () => {
      stop();
      for (const pc of pcs.values()) pc.close();
      pcs.clear();
      setRemoteStreams({});
    };
  }, [room, stop]);

  return { active, start, stop, localStream, remoteStreams, error, source };
}

function hasDisplayCapture() {
  return typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getDisplayMedia);
}
function hasCameraCapture() {
  return typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
}

// Most mobile browsers (all of iOS Safari, most of Android Chrome) don't
// support getDisplayMedia at all, so screen capture from a website simply
// isn't possible there. Falling back to the device camera lets mobile users
// still broadcast something instead of just hitting an unsupported error.
type ScreenShareMode = "display" | "camera" | "unsupported";

function getScreenShareMode(): ScreenShareMode {
  if (hasDisplayCapture()) return "display";
  if (hasCameraCapture()) return "camera";
  return "unsupported";
}
function getScreenShareModeServer(): ScreenShareMode {
  return "display";
}
function noopSubscribe() {
  return () => {};
}

export function useScreenShareMode() {
  return useSyncExternalStore(noopSubscribe, getScreenShareMode, getScreenShareModeServer);
}

export function useRoomMedia(room: string) {
  // Each of the three dials is independent so the person can e.g. keep
  // 720p but drop bitrate, or keep quality but drop fps. Refs mirror the
  // state (same pattern as noiseSuppressionOnRef below) because capture()
  // only runs once per share start and would otherwise close over a stale
  // value from whatever render happened to create it.
  const [shareResolution, setShareResolutionState] = useState<ShareResolution>("720p");
  const [shareFps, setShareFpsState] = useState<ShareFps>(30);
  const [shareBitrate, setShareBitrateState] = useState<ShareBitrate>("medium");
  const shareResolutionRef = useRef(shareResolution);
  const shareFpsRef = useRef(shareFps);
  const shareBitrateRef = useRef(shareBitrate);

  const setShareResolution = useCallback((value: ShareResolution) => {
    shareResolutionRef.current = value;
    setShareResolutionState(value);
    trackEvent(`screen_share_resolution_${value}`);
  }, []);
  const setShareFps = useCallback((value: ShareFps) => {
    shareFpsRef.current = value;
    setShareFpsState(value);
    trackEvent(`screen_share_fps_${value}`);
  }, []);
  const setShareBitrate = useCallback((value: ShareBitrate) => {
    shareBitrateRef.current = value;
    setShareBitrateState(value);
    trackEvent(`screen_share_bitrate_${value}`);
  }, []);

  // Recomputed only when one of the three dials actually changes, so this
  // stays a stable reference for useBroadcastChannel's live-reapply effect
  // in between.
  const screenQualityPreset = useMemo<QualityPreset>(() => {
    const dims = RESOLUTION_DIMENSIONS[shareResolution];
    return {
      width: dims.width,
      height: dims.height,
      frameRate: shareFps,
      maxBitrateKbps: BITRATE_KBPS[shareBitrate],
    };
  }, [shareResolution, shareFps, shareBitrate]);

  const screen = useBroadcastChannel(
    "screen",
    room,
    (source) => {
      const dims = RESOLUTION_DIMENSIONS[shareResolutionRef.current];
      const videoConstraints: MediaTrackConstraints = {
        width: { ideal: dims.width },
        height: { ideal: dims.height },
        frameRate: { ideal: shareFpsRef.current },
      };
      if (source === "camera") {
        return navigator.mediaDevices.getUserMedia({
          video: { ...videoConstraints, facingMode: "user" },
        });
      }
      // No fallback to the camera here — on browsers without getDisplayMedia
      // (most mobile ones) this throws synchronously, which start() below
      // turns into a visible error instead of silently switching sources.
      return navigator.mediaDevices.getDisplayMedia({ video: videoConstraints, audio: true });
    },
    () => hasDisplayCapture() || hasCameraCapture(),
    "Seu navegador não suporta compartilhamento de tela nem câmera.",
    "Não foi possível iniciar o compartilhamento. Verifique as permissões do navegador.",
    screenQualityPreset
  );

  // Mirrors noiseSuppressionOn below without going stale inside the capture
  // closure, which useBroadcastChannel only ever calls once per mic start
  // (long after a later render could have updated a captured `const`).
  const noiseSuppressionOnRef = useRef(true);
  const [noiseSuppressionOn, setNoiseSuppressionOnState] = useState(true);
  // Non-null only while the mic is active AND RNNoise actually loaded —
  // used both to reroute the live audio graph on toggle and to tell the UI
  // whether suppression is really in effect right now.
  const micGraphRef = useRef<MicNoiseGraph | null>(null);
  const [noiseSuppressionAvailable, setNoiseSuppressionAvailable] = useState(true);

  const mic = useBroadcastChannel(
    "mic",
    room,
    async () => {
      const { stream, graph } = await captureNoiseSuppressedMic(noiseSuppressionOnRef.current, () => {
        micGraphRef.current = null;
      });
      micGraphRef.current = graph;
      setNoiseSuppressionAvailable(graph !== null);
      return stream;
    },
    () => Boolean(navigator.mediaDevices?.getUserMedia),
    "Seu navegador não suporta microfone.",
    "Não foi possível ativar o microfone. Verifique a permissão do navegador."
  );

  const toggleMic = useCallback(() => {
    if (mic.active) mic.stop();
    else mic.start();
  }, [mic]);

  const toggleNoiseSuppression = useCallback(() => {
    const next = !noiseSuppressionOnRef.current;
    noiseSuppressionOnRef.current = next;
    setNoiseSuppressionOnState(next);
    setGraphSuppressionEnabled(micGraphRef.current, next);
    trackEvent(next ? "noise_suppression_on" : "noise_suppression_off");
  }, []);

  return {
    isSharing: screen.active,
    startShare: screen.start,
    stopShare: screen.stop,
    localStream: screen.localStream,
    remoteStreams: screen.remoteStreams,
    shareError: screen.error,
    shareSource: screen.source,
    shareResolution,
    setShareResolution,
    shareFps,
    setShareFps,
    shareBitrate,
    setShareBitrate,

    isMicOn: mic.active,
    toggleMic,
    micError: mic.error,
    localMicStream: mic.localStream,
    remoteMicStreams: mic.remoteStreams,

    noiseSuppressionOn,
    // Only meaningful once the mic has actually started — before that it's
    // just the pending preference for the next start.
    noiseSuppressionAvailable,
    toggleNoiseSuppression,
  };
}
