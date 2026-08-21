// NEXT_PUBLIC_TURN_URLS aceita uma ou mais URLs separadas por vírgula.
// Cada entrada vazia precisa sumir: `"".split(",")` devolve `[""]`, e uma
// string vazia dentro de `urls` faz o RTCPeerConnection inteiro lançar
// `SyntaxError: '' is not a valid URL` — derrubando também o STUN que vem
// antes dela, ou seja, nenhuma conexão P2P é criada. Sem TURN configurado a
// entrada é omitida por completo em vez de entrar vazia.
function parseTurnUrls(raw: string): string[] {
  return raw
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);
}

const TURN_URLS = parseTurnUrls(process.env.NEXT_PUBLIC_TURN_URLS || "");
const TURN_USERNAME = process.env.NEXT_PUBLIC_TURN_USERNAME || "";
const TURN_CREDENTIAL = process.env.NEXT_PUBLIC_TURN_CREDENTIAL || "";

// Whether "Impedir conexões diretas" (see WatchRoom.tsx) has anything to
// actually turn on. iceTransportPolicy: "relay" with no TURN server gathers
// zero usable candidates — not "worse privacy", a connection that can never
// establish at all — so the UI must disable that toggle when this is false.
export const TURN_CONFIGURED = TURN_URLS.length > 0;

export const ICE_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    ...(TURN_URLS.length > 0
      ? [{ urls: TURN_URLS, username: TURN_USERNAME, credential: TURN_CREDENTIAL }]
      : []),
  ],
};

// Restricts this peer connection to relay (TURN) candidates only — our own
// host/srflx candidates are still gathered locally but never offered to the
// remote peer, so it only ever learns our TURN server's address, never our
// own. This is a per-side setting: it protects whoever sets it on *their*
// own connections regardless of what the other end does, which is exactly
// what "hide my IP from other participants" needs.
const RELAY_ONLY_ICE_CONFIG: RTCConfiguration = {
  ...ICE_CONFIG,
  iceTransportPolicy: "relay",
};

/** The config to construct one RTCPeerConnection with, given the caller's own "force TURN" preference. */
export function iceConfigFor(forceRelay: boolean): RTCConfiguration {
  return forceRelay && TURN_CONFIGURED ? RELAY_ONLY_ICE_CONFIG : ICE_CONFIG;
}
