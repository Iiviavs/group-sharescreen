import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";

const HANDLE_RE = /^[a-zA-Z0-9_-]{1,32}$/;
const CLIENT_ID_RE = /^[a-zA-Z0-9-]{8,64}$/;
const HEARTBEAT_INTERVAL_MS = 25_000;

// Any handle starting with this is private: excluded from the public /rooms
// listing. This is the only thing that makes a room private — there's no
// separate flag to keep in sync, so it can't drift from the handle itself.
const PRIVATE_PREFIX = "priv-";

function isPrivateRoom(room: string): boolean {
  return room.startsWith(PRIVATE_PREFIX);
}

interface ClientInfo {
  id: string;
  name: string | null;
  room: string | null;
  sharing: boolean;
  mic: boolean;
  isAlive: boolean;
  socket: WebSocket;
}

interface RoomInfo {
  sockets: Set<WebSocket>;
  createdAt: number;
}

const clients = new Map<WebSocket, ClientInfo>();
const clientsById = new Map<string, ClientInfo>();
const namesInUse = new Map<string, WebSocket>();
const rooms = new Map<string, RoomInfo>();

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
  const roomInfo = rooms.get(room);
  if (!roomInfo) return;
  for (const s of roomInfo.sockets) {
    if (s !== exclude) send(s, msg);
  }
}

function peerSummary(info: ClientInfo) {
  return { id: info.id, name: info.name, sharing: info.sharing, mic: info.mic };
}

function leaveRoom(info: ClientInfo) {
  if (!info.room) return;
  const room = info.room;
  const roomInfo = rooms.get(room);
  if (roomInfo) {
    roomInfo.sockets.delete(info.socket);
    if (roomInfo.sockets.size === 0) rooms.delete(room);
  }
  info.room = null;
  info.sharing = false;
  info.mic = false;
  broadcastToRoom(room, { type: "peer-left", id: info.id }, info.socket);
}

// Used when a reconnect (same persisted client id) shows up before the old
// socket has been reaped yet — e.g. a brief network blip, or a second tab.
// Removes the stale session from every bookkeeping structure and closes it
// *without* broadcasting peer-left, since this identity is carried over
// seamlessly to the new socket rather than actually leaving the room.
function detachSession(info: ClientInfo) {
  if (info.room) {
    const roomInfo = rooms.get(info.room);
    if (roomInfo) {
      roomInfo.sockets.delete(info.socket);
      if (roomInfo.sockets.size === 0) rooms.delete(info.room);
    }
    info.room = null;
  }
  if (info.name && namesInUse.get(info.name.toLowerCase()) === info.socket) {
    namesInUse.delete(info.name.toLowerCase());
  }
  if (clientsById.get(info.id) === info) clientsById.delete(info.id);
  clients.delete(info.socket);
  info.socket.terminate();
}

export function registerSignalingRoutes(app: FastifyInstance, genId: () => string) {
  // Detects and reaps half-dead connections (network dropped without a clean
  // close, e.g. mobile network handoff, sleeping laptop, NAT/proxy silently
  // dropping an idle socket). Without this, a client can vanish for other
  // peers with no "peer-left" until the OS eventually notices the TCP
  // connection is gone, which can take minutes — the pings also generate
  // periodic traffic that keeps idle-timeout proxies from killing the
  // connection in the first place.
  const heartbeat = setInterval(() => {
    for (const info of clients.values()) {
      if (!info.isAlive) {
        info.socket.terminate();
        continue;
      }
      info.isAlive = false;
      info.socket.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);

  app.addHook("onClose", (_instance, done) => {
    clearInterval(heartbeat);
    done();
  });

  // Public room directory. Private rooms (handle starts with "priv-") are
  // filtered out here, server-side — the client never receives them, so
  // there's no separate access-control step to forget on the frontend.
  app.get("/rooms", async () => {
    const publicRooms = [...rooms.entries()]
      .filter(([handle]) => !isPrivateRoom(handle))
      .map(([handle, info]) => ({
        handle,
        peopleCount: info.sockets.size,
        createdAt: info.createdAt,
      }))
      .sort((a, b) => b.peopleCount - a.peopleCount || a.createdAt - b.createdAt);
    return { rooms: publicRooms };
  });

  app.get("/ws", { websocket: true }, (socket: WebSocket) => {
    const info: ClientInfo = {
      id: genId(),
      name: null,
      room: null,
      sharing: false,
      mic: false,
      isAlive: true,
      socket,
    };
    clients.set(socket, info);
    send(socket, { type: "welcome", id: info.id });

    socket.on("pong", () => {
      info.isAlive = true;
    });

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

          // A client-supplied id (persisted client-side across reloads and
          // reconnects) lets a returning client reclaim its previous
          // identity instead of showing up as a stranger to everyone else's
          // still-open peer connections. If a stale session under that id
          // is still around (server restart wiped nothing since it's a
          // fresh process, but a plain reconnect can race the heartbeat
          // reaper), take it over cleanly first.
          const requestedClientId = typeof msg.clientId === "string" ? msg.clientId : "";
          const clientId = CLIENT_ID_RE.test(requestedClientId) ? requestedClientId : null;
          const existingById = clientId ? clientsById.get(clientId) : undefined;
          if (existingById && existingById.socket !== socket) {
            detachSession(existingById);
          }

          const key = rawName.toLowerCase();
          const existingByName = namesInUse.get(key);
          if (existingByName && existingByName !== socket) {
            send(socket, { type: "register-error", message: "Esse nome já está em uso." });
            return;
          }
          const previousName = info.name;
          if (info.name) namesInUse.delete(info.name.toLowerCase());
          info.name = rawName;
          namesInUse.set(key, socket);

          if (clientId && clientId !== info.id) {
            if (clientsById.get(info.id) === info) clientsById.delete(info.id);
            info.id = clientId;
          }
          clientsById.set(info.id, info);

          send(socket, { type: "registered", id: info.id, name: rawName });

          // Renaming while already in a room doesn't go through "join"
          // again, so nothing else would tell the other participants —
          // without this their peer list would keep showing the old name.
          if (info.room && previousName && previousName !== rawName) {
            broadcastToRoom(info.room, { type: "peer-renamed", id: info.id, name: rawName }, socket);
          }
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
          info.mic = false;
          let roomInfo = rooms.get(room);
          if (!roomInfo) {
            roomInfo = { sockets: new Set(), createdAt: Date.now() };
            rooms.set(room, roomInfo);
          }
          roomInfo.sockets.add(socket);
          const peers = [...roomInfo.sockets]
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
        case "mic": {
          if (!info.room) return;
          info.mic = Boolean(msg.mic);
          broadcastToRoom(info.room, { type: "peer-mic", id: info.id, mic: info.mic });
          break;
        }
        case "signal": {
          if (!info.room) return;
          const targetId = typeof msg.to === "string" ? msg.to : "";
          const roomInfo = rooms.get(info.room);
          if (!roomInfo) return;
          for (const s of roomInfo.sockets) {
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
      // Guard against a stale/superseded session's delayed close event
      // wiping out a newer reconnect that already took over this name/id.
      if (info.name && namesInUse.get(info.name.toLowerCase()) === socket) {
        namesInUse.delete(info.name.toLowerCase());
      }
      if (clientsById.get(info.id) === info) clientsById.delete(info.id);
      clients.delete(socket);
    });
  });
}
