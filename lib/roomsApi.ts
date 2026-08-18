const WS_URL = process.env.NEXT_PUBLIC_SIGNALING_URL || "ws://localhost:4000/ws";

// The signaling server also serves plain HTTP endpoints (health, room
// directory) on the same host — derive that base from the WS URL instead of
// needing a second env var for what's really the same server.
export function getSignalingHttpBase(): string {
  return WS_URL.replace(/^ws/, "http").replace(/\/ws\/?$/, "");
}

export const PRIVATE_ROOM_PREFIX = "priv-";

export function toRoomHandle(rawHandle: string, isPrivate: boolean): string {
  return isPrivate ? `${PRIVATE_ROOM_PREFIX}${rawHandle}` : rawHandle;
}

export function isPrivateRoomHandle(handle: string): boolean {
  return handle.startsWith(PRIVATE_ROOM_PREFIX);
}

export type PublicRoom = {
  handle: string;
  peopleCount: number;
  createdAt: number;
};

export async function fetchPublicRooms(signal?: AbortSignal): Promise<PublicRoom[]> {
  const res = await fetch(`${getSignalingHttpBase()}/rooms`, { signal });
  if (!res.ok) throw new Error(`Falha ao carregar salas (status ${res.status})`);
  const data = (await res.json()) as { rooms: PublicRoom[] };
  return data.rooms;
}
