"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { adminSignalingClient, type AdminPeerInfo } from "./adminClient";
import type { ChatMessage } from "./signalingClient";
import { ICE_CONFIG } from "./iceConfig";

type Channel = "screen" | "mic";

type SignalData = {
  channel?: Channel;
  role?: "broadcaster" | "viewer";
  kind?: "offer" | "answer" | "ice" | "stop" | "peer-left";
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};

// Receive-only mirror of the "viewer" half of useBroadcastChannel in
// useRoomMedia.ts — a moderator only ever watches/listens, it never
// broadcasts a stream of its own, so there's no send side to build here.
// stopWatchingPeer/resumeWatchingPeer below mirror useRoomMedia's viewer-side
// pause protocol (kind "stop"/"resume", role "viewer") — the broadcaster's
// own useBroadcastChannel already handles that generically per sender
// peerId, with no idea (or need to know) whether the viewer asking is a
// regular participant or a silent moderator.
function useAdminChannel(channel: Channel) {
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  // Mirrors useRoomMedia's stoppedPeers/resumingPeers: a peer a moderator
  // deliberately stopped watching keeps a tile slot (placeholder) instead of
  // just disappearing, and one being resumed shows a brief loading state
  // instead of vanishing between the resume click and the fresh stream.
  const [stoppedPeers, setStoppedPeers] = useState<Set<string>>(new Set());
  const [resumingPeers, setResumingPeers] = useState<Set<string>>(new Set());
  const stoppedPeersRef = useRef(stoppedPeers);
  useEffect(() => {
    stoppedPeersRef.current = stoppedPeers;
  }, [stoppedPeers]);
  const resumingPeersRef = useRef(resumingPeers);
  useEffect(() => {
    resumingPeersRef.current = resumingPeers;
  }, [resumingPeers]);
  const recvPCs = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingCandidates = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());

  const clearStopped = useCallback((peerId: string) => {
    setStoppedPeers((prev) => {
      if (!prev.has(peerId)) return prev;
      const next = new Set(prev);
      next.delete(peerId);
      return next;
    });
  }, []);
  const clearResuming = useCallback((peerId: string) => {
    setResumingPeers((prev) => {
      if (!prev.has(peerId)) return prev;
      const next = new Set(prev);
      next.delete(peerId);
      return next;
    });
  }, []);

  const removeRemoteStream = useCallback((peerId: string) => {
    setRemoteStreams((prev) => {
      if (!(peerId in prev)) return prev;
      const next = { ...prev };
      delete next[peerId];
      return next;
    });
  }, []);

  const closeRecvPC = useCallback(
    (peerId: string) => {
      const pc = recvPCs.current.get(peerId);
      if (pc) {
        pc.close();
        recvPCs.current.delete(peerId);
      }
      pendingCandidates.current.delete(peerId);
      removeRemoteStream(peerId);
    },
    [removeRemoteStream]
  );

  // Called when a peer is genuinely gone (left the room, or stopped sharing
  // altogether) rather than just paused by the moderator — nothing left to
  // "come back" to, so the stopped/resuming markers get dropped too.
  const closeRecvPCFully = useCallback(
    (peerId: string) => {
      closeRecvPC(peerId);
      clearStopped(peerId);
      clearResuming(peerId);
    },
    [closeRecvPC, clearStopped, clearResuming]
  );

  const stopWatchingPeer = useCallback(
    (peerId: string) => {
      closeRecvPC(peerId);
      adminSignalingClient.sendSignal(peerId, { channel, role: "viewer", kind: "stop" });
      setStoppedPeers((prev) => {
        if (prev.has(peerId)) return prev;
        const next = new Set(prev);
        next.add(peerId);
        return next;
      });
    },
    [channel, closeRecvPC]
  );

  const resumeWatchingPeer = useCallback(
    (peerId: string) => {
      clearStopped(peerId);
      setResumingPeers((prev) => {
        if (prev.has(peerId)) return prev;
        const next = new Set(prev);
        next.add(peerId);
        return next;
      });
      adminSignalingClient.sendSignal(peerId, { channel, role: "viewer", kind: "resume" });
    },
    [channel, clearStopped]
  );

  const openRecvPC = useCallback(
    (peerId: string) => {
      const pc = new RTCPeerConnection(ICE_CONFIG);
      recvPCs.current.set(peerId, pc);
      pc.ontrack = (e) => {
        setRemoteStreams((prev) => ({ ...prev, [peerId]: e.streams[0] }));
        clearResuming(peerId);
      };
      pc.onicecandidate = (e) => {
        if (e.candidate) {
          adminSignalingClient.sendSignal(peerId, {
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
        }
      };
      return pc;
    },
    [channel, closeRecvPC, clearResuming]
  );

  useEffect(() => {
    const unsubscribeSignal = adminSignalingClient.onSignal((from, rawData) => {
      const data = rawData as SignalData;
      if (data.kind === "peer-left") {
        closeRecvPCFully(from);
        return;
      }
      if (data.channel !== channel || data.role !== "broadcaster") return;

      if (data.kind === "offer" && data.sdp) {
        if (recvPCs.current.has(from)) closeRecvPC(from);
        const thisPc = openRecvPC(from);
        thisPc
          .setRemoteDescription(data.sdp)
          .then(async () => {
            if (recvPCs.current.get(from) !== thisPc) return null;
            const queued = pendingCandidates.current.get(from);
            if (queued) {
              pendingCandidates.current.delete(from);
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
            adminSignalingClient.sendSignal(from, {
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
          const queue = pendingCandidates.current.get(from) ?? [];
          queue.push(data.candidate);
          pendingCandidates.current.set(from, queue);
        }
      } else if (data.kind === "stop") {
        // The broadcaster stopped sharing entirely — nothing to "come back"
        // to, so this fully clears the tile instead of leaving a
        // stopped-by-us placeholder behind.
        closeRecvPCFully(from);
      }
    });

    return () => {
      unsubscribeSignal();
    };
  }, [channel, openRecvPC, closeRecvPC, closeRecvPCFully]);

  useEffect(() => {
    const pcs = recvPCs.current;
    return () => {
      for (const pc of pcs.values()) pc.close();
      pcs.clear();
      setRemoteStreams({});
      setStoppedPeers(new Set());
      setResumingPeers(new Set());
    };
  }, []);

  return { remoteStreams, stoppedPeers, resumingPeers, stopWatchingPeer, resumeWatchingPeer };
}

export type AdminRoomViewerState = {
  status: "idle" | "connecting" | "open" | "closed" | "unauthorized";
  error: string | null;
  peers: AdminPeerInfo[];
  chatMessages: ChatMessage[];
  selfId: string | null;
  screenStreams: Record<string, MediaStream>;
  micStreams: Record<string, MediaStream>;
  stoppedScreenPeers: Set<string>;
  resumingScreenPeers: Set<string>;
  stopWatchingScreenPeer: (peerId: string) => void;
  resumeWatchingScreenPeer: (peerId: string) => void;
};

// Joins `room` as a silent moderator (see server/signaling.ts's
// "admin-join") for as long as this hook is mounted, and tears the
// connection down on unmount — leaving is just closing the socket, same as
// any other disconnect.
export function useAdminRoomViewer(room: string, token: string | null): AdminRoomViewerState {
  useEffect(() => {
    if (!token) return;
    adminSignalingClient.connect(room, token);
    return () => adminSignalingClient.disconnect();
  }, [room, token]);

  const screen = useAdminChannel("screen");
  const mic = useAdminChannel("mic");

  const [state, setState] = useState(adminSignalingClient.getSnapshot());
  useEffect(() => {
    const unsubscribe = adminSignalingClient.subscribe(() =>
      setState(adminSignalingClient.getSnapshot())
    );
    return () => {
      unsubscribe();
    };
  }, []);

  return {
    status: state.status,
    error: state.error,
    peers: state.peers,
    chatMessages: state.chatMessages,
    selfId: state.selfId,
    screenStreams: screen.remoteStreams,
    micStreams: mic.remoteStreams,
    stoppedScreenPeers: screen.stoppedPeers,
    resumingScreenPeers: screen.resumingPeers,
    stopWatchingScreenPeer: screen.stopWatchingPeer,
    resumeWatchingScreenPeer: screen.resumeWatchingPeer,
  };
}
