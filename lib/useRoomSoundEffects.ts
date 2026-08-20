"use client";

import { useEffect, useRef } from "react";
import { signalingClient, type PeerInfo, type SignalingState } from "./signalingClient";
import {
  playJoinSound,
  playLeaveSound,
  playMentionSound,
  playShareStartSound,
  playShareStopSound,
} from "./soundEffects";

// Plays a sound whenever another peer joins/leaves the room, starts/stops
// sharing, or mentions this user in chat. Deliberately scoped to *other*
// peers/messages only — the local user already gets immediate feedback from
// clicking their own buttons, so echoing that back as a sound would be
// redundant (and, for sharing, would double up with the mic/share toggle
// sounds a browser or OS might already play).
export function useRoomSoundEffects(state: SignalingState) {
  const prevPeersRef = useRef<Map<string, PeerInfo>>(new Map());
  const chatBaselineRef = useRef(0);
  // False until the first "room-state" this hook has seen — guards against
  // treating a room's entire existing peer list / chat history as a burst
  // of brand new joins and mentions the moment this hook mounts.
  const readyRef = useRef(false);

  useEffect(() => {
    // Fires on every "room-state" — the initial join, a room switch, and a
    // reconnect rejoining the same room — so each of those re-baselines
    // instead of being misread as every peer joining/leaving at once.
    const unsubscribe = signalingClient.onRoomJoined(() => {
      prevPeersRef.current = new Map(signalingClient.state.peers.map((p) => [p.id, p]));
      chatBaselineRef.current = signalingClient.state.chatMessages.length;
      readyRef.current = true;
    });
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!readyRef.current || !state.room) return;
    const prevPeers = prevPeersRef.current;
    const nextPeers = new Map(state.peers.map((p) => [p.id, p]));

    for (const [id, peer] of nextPeers) {
      const prev = prevPeers.get(id);
      if (!prev) {
        playJoinSound();
        continue;
      }
      if (!prev.sharing && peer.sharing) playShareStartSound();
      else if (prev.sharing && !peer.sharing) playShareStopSound();
    }
    for (const id of prevPeers.keys()) {
      if (!nextPeers.has(id)) playLeaveSound();
    }

    prevPeersRef.current = nextPeers;
  }, [state.peers, state.room]);

  useEffect(() => {
    if (!readyRef.current) return;
    const messages = state.chatMessages;
    const newMessages = messages.slice(chatBaselineRef.current);
    chatBaselineRef.current = messages.length;
    if (!state.name || newMessages.length === 0) return;

    const mentionToken = `@${state.name}`.toLowerCase();
    const mentioned = newMessages.some(
      (m) =>
        m.from !== state.selfId &&
        m.kind !== "gif" &&
        m.text.toLowerCase().includes(mentionToken)
    );
    if (mentioned) playMentionSound();
  }, [state.chatMessages, state.name, state.selfId]);
}
