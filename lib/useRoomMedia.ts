"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { signalingClient } from "./signalingClient";

const ICE_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

type SignalData = {
  role?: "broadcaster" | "viewer";
  kind?: "offer" | "answer" | "ice" | "stop" | "peer-left";
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};

export function useRoomMedia(room: string) {
  const [isSharing, setIsSharing] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [shareError, setShareError] = useState<string | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const sendPCs = useRef<Map<string, RTCPeerConnection>>(new Map());
  const recvPCs = useRef<Map<string, RTCPeerConnection>>(new Map());
  const isSharingRef = useRef(false);
  const pendingSendCandidates = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const pendingRecvCandidates = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());

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

  const openSendPC = useCallback(
    (peerId: string) => {
      if (sendPCs.current.has(peerId) || !localStreamRef.current) return;
      const stream = localStreamRef.current;
      const pc = new RTCPeerConnection(ICE_CONFIG);
      sendPCs.current.set(peerId, pc);
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      pc.onicecandidate = (e) => {
        if (e.candidate) {
          signalingClient.sendSignal(peerId, {
            role: "broadcaster",
            kind: "ice",
            candidate: e.candidate.toJSON(),
          });
        }
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed" || pc.connectionState === "closed") {
          closeSendPC(peerId);
        }
      };
      pc.createOffer()
        .then(async (offer) => {
          await pc.setLocalDescription(offer);
          signalingClient.sendSignal(peerId, {
            role: "broadcaster",
            kind: "offer",
            sdp: pc.localDescription,
          });
        })
        .catch(() => closeSendPC(peerId));
    },
    [closeSendPC]
  );

  const stopShare = useCallback(() => {
    if (!isSharingRef.current) return;
    isSharingRef.current = false;
    setIsSharing(false);
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    setLocalStream(null);
    for (const [peerId, pc] of sendPCs.current) {
      signalingClient.sendSignal(peerId, { role: "broadcaster", kind: "stop" });
      pc.close();
    }
    sendPCs.current.clear();
    signalingClient.setSharing(false);
  }, []);

  const startShare = useCallback(async () => {
    if (isSharingRef.current) return;
    setShareError(null);
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setShareError("Seu navegador não suporta compartilhamento de tela.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      localStreamRef.current = stream;
      isSharingRef.current = true;
      setLocalStream(stream);
      setIsSharing(true);
      signalingClient.setSharing(true);
      stream.getVideoTracks()[0]?.addEventListener("ended", () => stopShare());
      for (const peer of signalingClient.state.peers) {
        openSendPC(peer.id);
      }
    } catch {
      setShareError("Não foi possível iniciar o compartilhamento de tela.");
    }
  }, [openSendPC, stopShare]);

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
            role: "viewer",
            kind: "ice",
            candidate: e.candidate.toJSON(),
          });
        }
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed" || pc.connectionState === "closed") {
          closeRecvPC(peerId);
        }
      };
      return pc;
    },
    [closeRecvPC]
  );

  useEffect(() => {
    const unsubscribeSignal = signalingClient.onSignal((from, rawData) => {
      const data = rawData as SignalData;
      if (data.kind === "peer-left") {
        closeSendPC(from);
        closeRecvPC(from);
        return;
      }
      if (data.role === "broadcaster") {
        if (data.kind === "offer" && data.sdp) {
          let pc = recvPCs.current.get(from);
          if (!pc) pc = openRecvPC(from);
          pc.setRemoteDescription(data.sdp)
            .then(async () => {
              const queued = pendingRecvCandidates.current.get(from);
              if (queued) {
                pendingRecvCandidates.current.delete(from);
                for (const candidate of queued) {
                  await pc!.addIceCandidate(candidate).catch(() => {});
                }
              }
              return pc!.createAnswer();
            })
            .then((answer) => pc!.setLocalDescription(answer))
            .then(() => {
              signalingClient.sendSignal(from, {
                role: "viewer",
                kind: "answer",
                sdp: pc!.localDescription,
              });
            })
            .catch(() => closeRecvPC(from));
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
      if (isSharingRef.current) {
        for (const peer of signalingClient.state.peers) {
          if (!sendPCs.current.has(peer.id)) openSendPC(peer.id);
        }
      }
    });

    return () => {
      unsubscribeSignal();
      unsubscribeState();
    };
  }, [openRecvPC, openSendPC, closeSendPC, closeRecvPC]);

  useEffect(() => {
    const pcs = recvPCs.current;
    return () => {
      stopShare();
      for (const pc of pcs.values()) pc.close();
      pcs.clear();
      setRemoteStreams({});
    };
  }, [room, stopShare]);

  return { isSharing, startShare, stopShare, localStream, remoteStreams, shareError };
}
