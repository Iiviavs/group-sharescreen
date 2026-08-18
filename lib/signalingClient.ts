"use client";

import { trackEvent } from "./analytics";

export type PeerInfo = { id: string; name: string; sharing: boolean; mic: boolean };

export type SignalingStatus = "idle" | "connecting" | "open" | "closed";

export type SignalingState = {
  status: SignalingStatus;
  selfId: string | null;
  name: string | null;
  nameError: string | null;
  room: string | null;
  peers: PeerInfo[];
};

type Listener = () => void;
type SignalListener = (from: string, data: Record<string, unknown>) => void;

const WS_URL = process.env.NEXT_PUBLIC_SIGNALING_URL || "ws://localhost:4000/ws";
const NAME_STORAGE_KEY = "sharescreen:name";
const CLIENT_ID_STORAGE_KEY = "sharescreen:clientId";

const initialState: SignalingState = {
  status: "idle",
  selfId: null,
  name: null,
  nameError: null,
  room: null,
  peers: [],
};

export function getStoredName(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(NAME_STORAGE_KEY);
  } catch {
    return null;
  }
}

function setStoredName(name: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (name) window.localStorage.setItem(NAME_STORAGE_KEY, name);
    else window.localStorage.removeItem(NAME_STORAGE_KEY);
  } catch {
    // ignored - localStorage may be unavailable (private mode, quota, etc.)
  }
}

// A stable per-browser id, persisted across reloads and reconnects
// (including after the signaling server itself restarts for a deploy) so a
// returning client can reclaim its previous identity instead of showing up
// as a stranger — which would otherwise orphan everyone else's still-open
// WebRTC connections to it. The server adopts whatever id we send it once
// registered, so this also self-heals if it's ever out of sync.
function getClientId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(CLIENT_ID_STORAGE_KEY);
  } catch {
    return null;
  }
}

function setClientId(id: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CLIENT_ID_STORAGE_KEY, id);
  } catch {
    // ignored - localStorage may be unavailable (private mode, quota, etc.)
  }
}

class SignalingClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private signalListeners = new Set<SignalListener>();
  private roomJoinedListeners = new Set<Listener>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private desiredName: string | null = null;
  private desiredRoom: string | null = null;

  state: SignalingState = initialState;

  constructor() {
    const storedName = getStoredName();
    if (storedName) this.register(storedName);
  }

  subscribe = (cb: Listener) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  getSnapshot = () => this.state;

  onSignal(cb: SignalListener) {
    this.signalListeners.add(cb);
    return () => this.signalListeners.delete(cb);
  }

  // Fires every time room-state is received, including after a reconnect
  // rejoins the same room — lets media channels re-announce sharing/mic
  // state, which the server resets to false for the new socket.
  onRoomJoined(cb: Listener) {
    this.roomJoinedListeners.add(cb);
    return () => this.roomJoinedListeners.delete(cb);
  }

  private setState(patch: Partial<SignalingState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  private ensureSocket() {
    if (typeof window === "undefined") return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.setState({ status: "connecting" });
    const ws = new WebSocket(WS_URL);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.setState({ status: "open" });
      if (this.desiredName) {
        this.rawSend({ type: "register", name: this.desiredName, clientId: getClientId() });
      }
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
      // Deliberately keep the last-known room/peers instead of blanking
      // them: the underlying WebRTC connections to those peers are
      // untouched by a brief signaling hiccup, so wiping the list here
      // made participants (and their sharing/mic dots) flicker away and
      // reappear even though their audio/video never actually stopped.
      // Once we reconnect, a fresh room-state reconciles anything that's
      // genuinely stale (see the pruning in useRoomMedia's onRoomJoined).
      this.setState({ status: "closed" });
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      ws.close();
    };
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || !this.desiredName) return;
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 10000);
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.ensureSocket();
    }, delay);
  }

  private handleMessage(msg: Record<string, unknown>) {
    switch (msg.type) {
      case "welcome":
        this.setState({ selfId: msg.id as string });
        break;
      case "registered":
        this.setState({ name: msg.name as string, nameError: null, selfId: msg.id as string });
        setStoredName(msg.name as string);
        setClientId(msg.id as string);
        trackEvent("name_registered");
        if (this.desiredRoom) this.rawSend({ type: "join", room: this.desiredRoom });
        break;
      case "register-error":
        this.setState({ nameError: msg.message as string });
        // If we already had a confirmed name, this was a rename attempt —
        // fall back to it instead of abandoning an otherwise-working
        // session (which would also stop future reconnects from
        // re-registering at all, since desiredName would be null).
        if (this.state.name) {
          this.desiredName = this.state.name;
        } else {
          this.desiredName = null;
          setStoredName(null);
        }
        trackEvent("name_register_error");
        break;
      case "room-state":
        this.setState({
          room: msg.room as string,
          selfId: msg.selfId as string,
          peers: msg.peers as PeerInfo[],
        });
        trackEvent("room_joined");
        this.roomJoinedListeners.forEach((l) => l());
        break;
      case "peer-joined": {
        // Idempotent by id: a peer that reclaimed its identity after a
        // reconnect can legitimately "join" again while still listed (its
        // stale departure isn't announced, to avoid tearing down otherwise
        // still-healthy WebRTC connections over a brief signaling hiccup).
        const alreadyKnown = this.state.peers.some((p) => p.id === msg.id);
        this.setState({
          peers: alreadyKnown
            ? this.state.peers.map((p) =>
                p.id === msg.id ? { ...p, name: msg.name as string, sharing: false, mic: false } : p
              )
            : [
                ...this.state.peers,
                { id: msg.id as string, name: msg.name as string, sharing: false, mic: false },
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
            p.id === msg.id ? { ...p, sharing: Boolean(msg.sharing) } : p
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
      case "signal":
        this.signalListeners.forEach((l) =>
          l(msg.from as string, msg.data as Record<string, unknown>)
        );
        break;
      default:
        break;
    }
  }

  private rawSend(msg: unknown) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  register(name: string) {
    this.desiredName = name;
    this.reconnectAttempts = 0;
    this.setState({ nameError: null });
    const wasOpen = this.ws && this.ws.readyState === WebSocket.OPEN;
    this.ensureSocket();
    if (wasOpen) this.rawSend({ type: "register", name, clientId: getClientId() });
  }

  joinRoom(room: string) {
    this.desiredRoom = room;
    if (this.state.name) this.rawSend({ type: "join", room });
  }

  leaveRoom() {
    this.desiredRoom = null;
    this.rawSend({ type: "leave" });
    this.setState({ room: null, peers: [] });
  }

  setSharing(sharing: boolean) {
    this.rawSend({ type: "sharing", sharing });
  }

  setMic(mic: boolean) {
    this.rawSend({ type: "mic", mic });
  }

  sendSignal(to: string, data: unknown) {
    this.rawSend({ type: "signal", to, data });
  }
}

export const signalingClient = new SignalingClient();
