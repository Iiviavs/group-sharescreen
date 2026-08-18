import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import {
  registerStatsProvider,
  wsConnectionsTotal,
  wsDisconnectionsTotal,
  heartbeatReapedTotal,
  registerErrorsTotal,
  roomsCreatedTotal,
  signalsRelayedTotal,
} from "./metrics.js";
import {
  ADMIN_ENABLED,
  checkBasicAuth,
  createAdminToken,
  verifyAdminToken,
  revokeAdminToken,
} from "./adminAuth.js";

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
  // Set for a moderator connection opened via "admin-join" (see
  // registerAdminRoutes below). Moderator sockets ride the exact same room
  // machinery as a real participant — they're added to the room's socket
  // set and included unfiltered in the peers array sent to real
  // participants, which is what makes broadcasters' existing
  // "open a connection to every peer I see" logic transparently push them
  // an offer too. The `role: "moderator"` tag on that peer entry (see
  // peerSummary) is what the *client* then uses to hide it from the visible
  // participant list and count — nothing server-side ever filters a
  // moderator out of a room, only out of numbers/lists real users see.
  isModerator?: boolean;
}

interface RoomInfo {
  sockets: Set<WebSocket>;
  createdAt: number;
}

const clients = new Map<WebSocket, ClientInfo>();
const clientsById = new Map<string, ClientInfo>();
const namesInUse = new Map<string, WebSocket>();
const rooms = new Map<string, RoomInfo>();

registerStatsProvider(() => ({
  connectedSockets: clients.size,
  registeredPeers: [...clients.values()].filter((c) => c.name !== null && !c.isModerator).length,
  rooms: [...rooms.entries()].map(([handle, info]) => ({
    handle,
    peopleCount: realPeopleCount(info),
    isPrivate: isPrivateRoom(handle),
  })),
}));

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
  return {
    id: info.id,
    name: info.name,
    sharing: info.sharing,
    mic: info.mic,
    ...(info.isModerator ? { role: "moderator" as const } : {}),
  };
}

// Real (non-moderator) headcount for a room — used everywhere a number or
// list is shown to an ordinary user, so a moderator watching never inflates
// what participants see.
function realPeopleCount(roomInfo: RoomInfo): number {
  let count = 0;
  for (const s of roomInfo.sockets) {
    if (!clients.get(s)?.isModerator) count += 1;
  }
  return count;
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
        heartbeatReapedTotal.inc();
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
        peopleCount: realPeopleCount(info),
        createdAt: info.createdAt,
      }))
      .sort((a, b) => b.peopleCount - a.peopleCount || a.createdAt - b.createdAt);
    return { rooms: publicRooms };
  });

  // Moderation surface, gated entirely behind ADMIN_USER/ADMIN_PASSWORD
  // (see adminAuth.ts) — every route below 404s outright if those env vars
  // aren't both set, so there's no accidental half-open admin endpoint on a
  // deployment that never opted in.
  app.post("/admin/login", async (request, reply) => {
    if (!ADMIN_ENABLED) return reply.code(404).send();
    if (!checkBasicAuth(request.headers.authorization)) {
      reply.header("WWW-Authenticate", 'Basic realm="admin"');
      return reply.code(401).send({ error: "unauthorized" });
    }
    return { token: createAdminToken() };
  });

  app.post("/admin/logout", async (request, reply) => {
    if (!ADMIN_ENABLED) return reply.code(404).send();
    const header = request.headers.authorization || "";
    if (header.startsWith("Bearer ")) revokeAdminToken(header.slice(7));
    return reply.code(204).send();
  });

  // Full room directory for moderators — unlike /rooms, this includes
  // private rooms and per-peer detail, since moderation is the one
  // legitimate reason to need that visibility.
  app.get("/admin/rooms", async (request, reply) => {
    if (!ADMIN_ENABLED) return reply.code(404).send();
    const header = request.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!verifyAdminToken(token)) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const allRooms = [...rooms.entries()]
      .map(([handle, info]) => ({
        handle,
        isPrivate: isPrivateRoom(handle),
        createdAt: info.createdAt,
        peopleCount: realPeopleCount(info),
        peers: [...info.sockets]
          .map((s) => clients.get(s))
          .filter((c): c is ClientInfo => c !== undefined && !c.isModerator)
          .map((c) => ({ id: c.id, name: c.name, sharing: c.sharing, mic: c.mic })),
      }))
      .sort((a, b) => b.peopleCount - a.peopleCount || a.createdAt - b.createdAt);
    return { rooms: allRooms };
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
    wsConnectionsTotal.inc();
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
            registerErrorsTotal.inc();
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
            registerErrorsTotal.inc();
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
            roomsCreatedTotal.inc({ visibility: isPrivateRoom(room) ? "private" : "public" });
          }
          roomInfo.sockets.add(socket);
          const peers = [...roomInfo.sockets]
            .filter((s) => s !== socket)
            .map((s) => peerSummary(clients.get(s)!));
          send(socket, { type: "room-state", room, selfId: info.id, peers });
          broadcastToRoom(room, { type: "peer-joined", id: info.id, name: info.name }, socket);
          break;
        }
        // A moderator entering a room to watch/listen for moderation.
        // Deliberately mirrors "join" (same room bookkeeping, same
        // room-state/peer-joined messages) so this socket rides the exact
        // same signal-relay and broadcaster-reactivity machinery a real
        // participant does — the only difference is the `role: "moderator"`
        // tag on its peer entry, which is what the client uses to keep it
        // out of the visible participant list/count. Leaving reuses the
        // plain "leave" message (and socket close already calls
        // leaveRoom() regardless), so no separate cleanup path is needed.
        case "admin-join": {
          if (!ADMIN_ENABLED) {
            send(socket, { type: "error", message: "Moderação desativada." });
            return;
          }
          const token = typeof msg.token === "string" ? msg.token : "";
          if (!verifyAdminToken(token)) {
            send(socket, { type: "error", message: "Não autorizado." });
            socket.terminate();
            return;
          }
          const room = typeof msg.room === "string" ? msg.room : "";
          if (!HANDLE_RE.test(room)) {
            send(socket, { type: "error", message: "Sala inválida." });
            return;
          }
          const roomInfo = rooms.get(room);
          if (!roomInfo) {
            send(socket, { type: "error", message: "Sala não encontrada ou já encerrada." });
            return;
          }
          if (info.room === room) return;
          if (info.room) leaveRoom(info);
          info.isModerator = true;
          info.name = info.name ?? "Moderador";
          info.room = room;
          info.sharing = false;
          info.mic = false;
          roomInfo.sockets.add(socket);
          const adminPeers = [...roomInfo.sockets]
            .filter((s) => s !== socket)
            .map((s) => peerSummary(clients.get(s)!));
          send(socket, { type: "room-state", room, selfId: info.id, peers: adminPeers });
          broadcastToRoom(room, { type: "peer-joined", id: info.id, name: info.name, role: "moderator" }, socket);
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
          const dataKind =
            msg.data && typeof msg.data === "object" && "kind" in msg.data
              ? String((msg.data as { kind: unknown }).kind)
              : "unknown";
          signalsRelayedTotal.inc({ kind: dataKind });
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
      wsDisconnectionsTotal.inc();
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
