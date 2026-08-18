"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { adminSignalingClient, type AdminPeerInfo } from "./adminClient";
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
function useAdminChannel(channel: Channel) {
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const recvPCs = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingCandidates = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());

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

  const openRecvPC = useCallback(
    (peerId: string) => {
      const pc = new RTCPeerConnection(ICE_CONFIG);
      recvPCs.current.set(peerId, pc);
      pc.ontrack = (e) => {
        setRemoteStreams((prev) => ({ ...prev, [peerId]: e.streams[0] }));
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
    [channel, closeRecvPC]
  );

  useEffect(() => {
    const unsubscribeSignal = adminSignalingClient.onSignal((from, rawData) => {
      const data = rawData as SignalData;
      if (data.kind === "peer-left") {
        closeRecvPC(from);
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
        closeRecvPC(from);
      }
    });

    return () => {
      unsubscribeSignal();
    };
  }, [channel, openRecvPC, closeRecvPC]);

  useEffect(() => {
    const pcs = recvPCs.current;
    return () => {
      for (const pc of pcs.values()) pc.close();
      pcs.clear();
      setRemoteStreams({});
    };
  }, []);

  return remoteStreams;
}

export type AdminRoomViewerState = {
  status: "idle" | "connecting" | "open" | "closed" | "unauthorized";
  error: string | null;
  peers: AdminPeerInfo[];
  screenStreams: Record<string, MediaStream>;
  micStreams: Record<string, MediaStream>;
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

  const screenStreams = useAdminChannel("screen");
  const micStreams = useAdminChannel("mic");

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
    screenStreams,
    micStreams,
  };
}
