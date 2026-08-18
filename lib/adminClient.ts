"use client";

const WS_URL = process.env.NEXT_PUBLIC_SIGNALING_URL || "ws://localhost:4000/ws";

export type AdminPeerInfo = { id: string; name: string; sharing: boolean; mic: boolean };

export type AdminClientStatus = "idle" | "connecting" | "open" | "closed" | "unauthorized";

export type AdminClientState = {
  status: AdminClientStatus;
  room: string | null;
  selfId: string | null;
  peers: AdminPeerInfo[];
  error: string | null;
};

type Listener = () => void;
type SignalListener = (from: string, data: Record<string, unknown>) => void;

const initialState: AdminClientState = {
  status: "idle",
  room: null,
  selfId: null,
  peers: [],
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
    this.disconnect();
    this.setState({ status: "connecting", room, peers: [], selfId: null, error: null });

    const ws = new WebSocket(WS_URL);
    this.ws = ws;

    ws.onopen = () => {
      this.setState({ status: "open" });
      ws.send(JSON.stringify({ type: "admin-join", room, token }));
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
      if (this.state.status !== "unauthorized") this.setState({ status: "closed" });
    };

    ws.onerror = () => ws.close();
  }

  disconnect() {
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      ws.close();
    }
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
        });
        break;
      case "peer-joined": {
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
        this.signalListeners.forEach((l) => l(msg.from as string, msg.data as Record<string, unknown>));
        break;
      case "error":
        this.setState({ status: "unauthorized", error: (msg.message as string) ?? "Não autorizado." });
        this.ws?.close();
        this.ws = null;
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
