"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { signalingClient } from "./signalingClient";

const TURN_URL = process.env.NEXT_PUBLIC_TURN_URL || "turn:n1-br.nemtudo.me:3478?transport=udp";
const TURN_USERNAME = process.env.NEXT_PUBLIC_TURN_USERNAME || "nemtudo";
const TURN_CREDENTIAL = process.env.NEXT_PUBLIC_TURN_CREDENTIAL || "nemtudomtforte123";

const ICE_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    {
      urls: TURN_URL,
      username: TURN_USERNAME,
      credential: TURN_CREDENTIAL,
    },
  ],
};

type Channel = "screen" | "mic";

type SignalData = {
  channel?: Channel;
  role?: "broadcaster" | "viewer";
  kind?: "offer" | "answer" | "ice" | "stop" | "peer-left";
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};

// Shared connection-management for a single media channel (screen share or
// mic), broadcast from this client to every peer in the room. Each channel
// gets its own set of peer connections and its own signaling namespace so
// screen-share and mic negotiation never interfere with each other.
function useBroadcastChannel(
  channel: Channel,
  room: string,
  capture: () => Promise<MediaStream>,
  isSupported: () => boolean,
  notSupportedMessage: string,
  failureMessage: string
) {
  const [active, setActive] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [error, setError] = useState<string | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const sendPCs = useRef<Map<string, RTCPeerConnection>>(new Map());
  const recvPCs = useRef<Map<string, RTCPeerConnection>>(new Map());
  const activeRef = useRef(false);
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
            channel,
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
            channel,
            role: "broadcaster",
            kind: "offer",
            sdp: pc.localDescription,
          });
        })
        .catch(() => closeSendPC(peerId));
    },
    [channel, closeSendPC]
  );

  const stop = useCallback(() => {
    if (!activeRef.current) return;
    activeRef.current = false;
    setActive(false);
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    setLocalStream(null);
    for (const [peerId, pc] of sendPCs.current) {
      signalingClient.sendSignal(peerId, { channel, role: "broadcaster", kind: "stop" });
      pc.close();
    }
    sendPCs.current.clear();
    if (channel === "screen") signalingClient.setSharing(false);
    else signalingClient.setMic(false);
  }, [channel]);

  const start = useCallback(async () => {
    if (activeRef.current) return;
    setError(null);
    if (!isSupported()) {
      setError(notSupportedMessage);
      return;
    }
    try {
      const stream = await capture();
      localStreamRef.current = stream;
      activeRef.current = true;
      setLocalStream(stream);
      setActive(true);
      if (channel === "screen") signalingClient.setSharing(true);
      else signalingClient.setMic(true);
      stream.getTracks().forEach((track) => track.addEventListener("ended", () => stop()));
      for (const peer of signalingClient.state.peers) {
        openSendPC(peer.id);
      }
    } catch {
      setError(failureMessage);
    }
  }, [capture, isSupported, notSupportedMessage, failureMessage, channel, openSendPC, stop]);

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
        if (pc.connectionState === "failed" || pc.connectionState === "closed") {
          closeRecvPC(peerId);
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
                channel,
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
      if (activeRef.current) {
        for (const peer of signalingClient.state.peers) {
          if (!sendPCs.current.has(peer.id)) openSendPC(peer.id);
        }
      }
    });

    return () => {
      unsubscribeSignal();
      unsubscribeState();
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

  return { active, start, stop, localStream, remoteStreams, error };
}

export function useRoomMedia(room: string) {
  const screen = useBroadcastChannel(
    "screen",
    room,
    () => navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }),
    () => Boolean(navigator.mediaDevices?.getDisplayMedia),
    "Seu navegador não suporta compartilhamento de tela.",
    "Não foi possível iniciar o compartilhamento de tela."
  );

  const mic = useBroadcastChannel(
    "mic",
    room,
    () => navigator.mediaDevices.getUserMedia({ audio: true }),
    () => Boolean(navigator.mediaDevices?.getUserMedia),
    "Seu navegador não suporta microfone.",
    "Não foi possível ativar o microfone. Verifique a permissão do navegador."
  );

  const toggleMic = useCallback(() => {
    if (mic.active) mic.stop();
    else mic.start();
  }, [mic]);

  return {
    isSharing: screen.active,
    startShare: screen.start,
    stopShare: screen.stop,
    localStream: screen.localStream,
    remoteStreams: screen.remoteStreams,
    shareError: screen.error,

    isMicOn: mic.active,
    toggleMic,
    micError: mic.error,
    remoteMicStreams: mic.remoteStreams,
  };
}
