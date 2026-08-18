import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";

const HANDLE_RE = /^[a-zA-Z0-9_-]{1,32}$/;

interface ClientInfo {
  id: string;
  name: string | null;
  room: string | null;
  sharing: boolean;
  socket: WebSocket;
}

const clients = new Map<WebSocket, ClientInfo>();
const namesInUse = new Map<string, WebSocket>();
const rooms = new Map<string, Set<WebSocket>>();

function isValidDisplayName(name: string): boolean {
  if (name.length < 1 || name.length > 24) return false;
  for (let i = 0; i < name.length; i += 1) {
    const code = name.charCodeAt(i);
    if (code < 32 || code === 127) return false;
  }
  return true;
}

function send(socket: WebSocket, msg: unknown) {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(msg));
  }
}

function broadcastToRoom(room: string, msg: unknown, exclude?: WebSocket) {
  const set = rooms.get(room);
  if (!set) return;
  for (const s of set) {
    if (s !== exclude) send(s, msg);
  }
}

function peerSummary(info: ClientInfo) {
  return { id: info.id, name: info.name, sharing: info.sharing };
}

function leaveRoom(info: ClientInfo) {
  if (!info.room) return;
  const room = info.room;
  const set = rooms.get(room);
  if (set) {
    set.delete(info.socket);
    if (set.size === 0) rooms.delete(room);
  }
  info.room = null;
  info.sharing = false;
  broadcastToRoom(room, { type: "peer-left", id: info.id }, info.socket);
}

export function registerSignalingRoutes(app: FastifyInstance, genId: () => string) {
  app.get("/ws", { websocket: true }, (socket: WebSocket) => {
    const info: ClientInfo = {
      id: genId(),
      name: null,
      room: null,
      sharing: false,
      socket,
    };
    clients.set(socket, info);
    send(socket, { type: "welcome", id: info.id });

    socket.on("message", (raw: Buffer) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!msg || typeof msg.type !== "string") return;

      switch (msg.type) {
        case "register": {
          const rawName = typeof msg.name === "string" ? msg.name.trim().slice(0, 24) : "";
          if (!isValidDisplayName(rawName)) {
            send(socket, { type: "register-error", message: "Nome inválido." });
            return;
          }
          const key = rawName.toLowerCase();
          const existing = namesInUse.get(key);
          if (existing && existing !== socket) {
            send(socket, { type: "register-error", message: "Esse nome já está em uso." });
            return;
          }
          if (info.name) namesInUse.delete(info.name.toLowerCase());
          info.name = rawName;
          namesInUse.set(key, socket);
          send(socket, { type: "registered", id: info.id, name: rawName });
          break;
        }
        case "join": {
          if (!info.name) {
            send(socket, { type: "error", message: "Registre um nome antes de entrar em uma sala." });
            return;
          }
          const room = typeof msg.room === "string" ? msg.room : "";
          if (!HANDLE_RE.test(room)) {
            send(socket, { type: "error", message: "Sala inválida." });
            return;
          }
          if (info.room === room) return;
          if (info.room) leaveRoom(info);
          info.room = room;
          info.sharing = false;
          let set = rooms.get(room);
          if (!set) {
            set = new Set();
            rooms.set(room, set);
          }
          set.add(socket);
          const peers = [...set]
            .filter((s) => s !== socket)
            .map((s) => peerSummary(clients.get(s)!));
          send(socket, { type: "room-state", room, selfId: info.id, peers });
          broadcastToRoom(room, { type: "peer-joined", id: info.id, name: info.name }, socket);
          break;
        }
        case "leave": {
          if (info.room) leaveRoom(info);
          break;
        }
        case "sharing": {
          if (!info.room) return;
          info.sharing = Boolean(msg.sharing);
          broadcastToRoom(info.room, { type: "peer-sharing", id: info.id, sharing: info.sharing });
          break;
        }
        case "signal": {
          if (!info.room) return;
          const targetId = typeof msg.to === "string" ? msg.to : "";
          const set = rooms.get(info.room);
          if (!set) return;
          for (const s of set) {
            const target = clients.get(s);
            if (target && target.id === targetId) {
              send(s, { type: "signal", from: info.id, data: msg.data });
              break;
            }
          }
          break;
        }
        default:
          break;
      }
    });

    socket.on("close", () => {
      if (info.room) leaveRoom(info);
      if (info.name) namesInUse.delete(info.name.toLowerCase());
      clients.delete(socket);
    });
  });
}
