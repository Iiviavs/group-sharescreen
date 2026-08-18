"use client";

export type PeerInfo = { id: string; name: string; sharing: boolean };

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

class SignalingClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private signalListeners = new Set<SignalListener>();
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
      if (this.desiredName) this.rawSend({ type: "register", name: this.desiredName });
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
      this.setState({ status: "closed", selfId: null, room: null, peers: [] });
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
        if (this.desiredRoom) this.rawSend({ type: "join", room: this.desiredRoom });
        break;
      case "register-error":
        this.setState({ nameError: msg.message as string });
        this.desiredName = null;
        setStoredName(null);
        break;
      case "room-state":
        this.setState({
          room: msg.room as string,
          selfId: msg.selfId as string,
          peers: msg.peers as PeerInfo[],
        });
        break;
      case "peer-joined":
        this.setState({
          peers: [...this.state.peers, { id: msg.id as string, name: msg.name as string, sharing: false }],
        });
        break;
      case "peer-left":
        this.setState({ peers: this.state.peers.filter((p) => p.id !== msg.id) });
        this.signalListeners.forEach((l) => l(msg.id as string, { kind: "peer-left" }));
        break;
      case "peer-sharing":
        this.setState({
          peers: this.state.peers.map((p) =>
            p.id === msg.id ? { ...p, sharing: Boolean(msg.sharing) } : p
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
    if (wasOpen) this.rawSend({ type: "register", name });
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

  sendSignal(to: string, data: unknown) {
    this.rawSend({ type: "signal", to, data });
  }
}

export const signalingClient = new SignalingClient();
