"use client";

import type { ChatMessage } from "./signalingClient";
import type { VideoSource } from "./videoSource";

const WS_URL = process.env.NEXT_PUBLIC_SIGNALING_URL || "ws://localhost:4000/ws";

export type AdminPeerInfo = {
  id: string;
  name: string;
  sharing: boolean;
  // Same fields/meaning as WatchRoom's PeerInfo.screen/camera — see their
  // doc comment in signalingClient.ts. null when the peer's client didn't
  // report which channel it is, undefined from an older server.
  screen?: boolean | null;
  camera?: boolean | null;
  mic: boolean;
  // Stable per-account/per-guest identity (see server/signaling.ts's
  // stableUserId) — same field WatchRoom's PeerInfo carries, used the same
  // way here to key persisted per-peer volume dials across reconnects.
  userId?: string;
  // Same field/meaning as WatchRoom's PeerInfo.isGuest — see its doc
  // comment in signalingClient.ts.
  isGuest?: boolean;
};

export type AdminClientStatus = "idle" | "connecting" | "open" | "closed" | "unauthorized";

export type AdminClientState = {
  status: AdminClientStatus;
  room: string | null;
  selfId: string | null;
  peers: AdminPeerInfo[];
  chatMessages: ChatMessage[];
  // The room's video sources (see lib/videoSource.ts). A moderator never
  // embeds them — only `addedById` is actually used here, to mark who in the
  // participant list put a video on everyone's screen, which is a different
  // kind of transmitting from a screen or camera share.
  videoSources: VideoSource[];
  error: string | null;
};

type Listener = () => void;
type SignalListener = (from: string, data: Record<string, unknown>) => void;

const initialState: AdminClientState = {
  status: "idle",
  room: null,
  selfId: null,
  peers: [],
  chatMessages: [],
  videoSources: [],
  error: null,
};

// A separate, minimal signaling connection for the moderation viewer — it
// deliberately does NOT reuse the regular `signalingClient` singleton,
// since that one is tied to the browser's persisted display name/clientId
// identity. A moderator authenticates with an admin token instead and only
// ever *receives* media (see useAdminRoomViewer), so it needs none of the
// register/rename/reconnect-as-the-same-person machinery the normal client
// carries.
class AdminSignalingClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private signalListeners = new Set<SignalListener>();
  // Mirrors signalingClient.ts's reconnect-with-backoff — the original
  // version here never retried at all, so any brief network hiccup left a
  // moderator stuck on "Conectando..." forever until they manually left and
  // reopened the viewer (this is most of what read as "a tela demora mais
  // pra carregar").
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private desiredRoom: string | null = null;
  private desiredToken: string | null = null;

  state: AdminClientState = initialState;

  subscribe = (cb: Listener) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  getSnapshot = () => this.state;

  onSignal(cb: SignalListener) {
    this.signalListeners.add(cb);
    return () => this.signalListeners.delete(cb);
  }

  private setState(patch: Partial<AdminClientState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  connect(room: string, token: string) {
    if (typeof window === "undefined") return;
    this.desiredRoom = room;
    this.desiredToken = token;
    this.reconnectAttempts = 0;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.openSocket();
  }

  private openSocket() {
    this.closeSocket();
    this.setState({
      status: "connecting",
      room: this.desiredRoom,
      peers: [],
      chatMessages: [],
      selfId: null,
      error: null,
    });

    const ws = new WebSocket(WS_URL);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.setState({ status: "open" });
      ws.send(JSON.stringify({ type: "admin-join", room: this.desiredRoom, token: this.desiredToken }));
    };

    ws.onmessage = (event) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(event.data as string);
      } catch {
        return;
      }
      this.handleMessage(msg);
    };

    ws.onclose = () => {
      if (this.state.status === "unauthorized") return;
      this.setState({ status: "closed" });
      this.scheduleReconnect();
    };

    ws.onerror = () => ws.close();
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || !this.desiredRoom || !this.desiredToken) return;
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 10000);
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }

  // Closes the socket without treating it as a dropped connection — used
  // both by an intentional disconnect() and internally before opening a
  // fresh one, so neither ever schedules a spurious reconnect for a close
  // this client itself initiated.
  private closeSocket() {
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      ws.onclose = null;
      ws.close();
    }
  }

  disconnect() {
    this.desiredRoom = null;
    this.desiredToken = null;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.closeSocket();
    this.setState(initialState);
  }

  private handleMessage(msg: Record<string, unknown>) {
    switch (msg.type) {
      case "welcome":
        this.setState({ selfId: msg.id as string });
        break;
      case "room-state":
        this.setState({
          room: msg.room as string,
          selfId: msg.selfId as string,
          peers: msg.peers as AdminPeerInfo[],
          chatMessages: Array.isArray(msg.messages) ? (msg.messages as ChatMessage[]) : [],
          videoSources: Array.isArray(msg.videoSources) ? (msg.videoSources as VideoSource[]) : [],
        });
        break;
      case "peer-joined": {
        const alreadyKnown = this.state.peers.some((p) => p.id === msg.id);
        const userId = typeof msg.userId === "string" ? msg.userId : undefined;
        const isGuest = Boolean(msg.isGuest);
        this.setState({
          peers: alreadyKnown
            ? this.state.peers.map((p) =>
                p.id === msg.id
                  ? { ...p, name: msg.name as string, sharing: false, mic: false, userId, isGuest }
                  : p
              )
            : [
                ...this.state.peers,
                { id: msg.id as string, name: msg.name as string, sharing: false, mic: false, userId, isGuest },
              ],
        });
        break;
      }
      case "peer-left":
        this.setState({ peers: this.state.peers.filter((p) => p.id !== msg.id) });
        this.signalListeners.forEach((l) => l(msg.id as string, { kind: "peer-left" }));
        break;
      case "peer-renamed":
        this.setState({
          peers: this.state.peers.map((p) =>
            p.id === msg.id ? { ...p, name: msg.name as string } : p
          ),
        });
        break;
      case "peer-sharing":
        this.setState({
          peers: this.state.peers.map((p) =>
            p.id === msg.id
              ? {
                  ...p,
                  sharing: Boolean(msg.sharing),
                  screen: typeof msg.screen === "boolean" ? msg.screen : null,
                  camera: typeof msg.camera === "boolean" ? msg.camera : null,
                }
              : p
          ),
        });
        break;
      case "peer-mic":
        this.setState({
          peers: this.state.peers.map((p) =>
            p.id === msg.id ? { ...p, mic: Boolean(msg.mic) } : p
          ),
        });
        break;
      // Only add/remove matter here: playback state (video-source-state) is
      // for players, and a moderator has none.
      case "video-source-added":
        this.setState({ videoSources: [...this.state.videoSources, msg.source as VideoSource] });
        break;
      case "video-source-removed":
        this.setState({ videoSources: this.state.videoSources.filter((v) => v.id !== msg.id) });
        break;
      case "signal":
        this.signalListeners.forEach((l) => l(msg.from as string, msg.data as Record<string, unknown>));
        break;
      case "chat-message": {
        const chatMessage: ChatMessage = {
          id: msg.id as string,
          from: msg.from as string,
          name: msg.name as string,
          isGuest: Boolean(msg.isGuest),
          kind: msg.kind === "gif" ? "gif" : "text",
          text: (msg.text as string) ?? "",
          url: typeof msg.url === "string" ? msg.url : undefined,
          ts: msg.ts as number,
        };
        this.setState({ chatMessages: [...this.state.chatMessages, chatMessage] });
        break;
      }
      case "error":
        // Not worth retrying — an admin token that was rejected once (bad
        // token, insufficient flags) will be rejected again identically, so
        // this drops the desired room/token to stop scheduleReconnect from
        // ever firing for it instead of looping forever against a
        // connection that can never succeed.
        this.desiredRoom = null;
        this.desiredToken = null;
        this.setState({ status: "unauthorized", error: (msg.message as string) ?? "Não autorizado." });
        this.closeSocket();
        break;
      default:
        break;
    }
  }

  sendSignal(to: string, data: unknown) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "signal", to, data }));
    }
  }
}

export const adminSignalingClient = new AdminSignalingClient();
