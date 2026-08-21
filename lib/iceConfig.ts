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

export const ICE_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    ...(TURN_URLS.length > 0
      ? [{ urls: TURN_URLS, username: TURN_USERNAME, credential: TURN_CREDENTIAL }]
      : []),
  ],
};
