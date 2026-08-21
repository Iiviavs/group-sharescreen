// node --experimental-strip-types lib/iceConfig.test.mts
//
// O invariante: nenhuma string vazia pode chegar em `urls`. Uma única entrada
// vazia faz `new RTCPeerConnection(ICE_CONFIG)` lançar SyntaxError e derruba
// TODA conexão P2P — inclusive o STUN que vem antes dela na lista.
import assert from "node:assert/strict";

async function loadWith(turnUrls: string | undefined) {
  if (turnUrls === undefined) delete process.env.NEXT_PUBLIC_TURN_URLS;
  else process.env.NEXT_PUBLIC_TURN_URLS = turnUrls;
  // Query única força o loader de ESM a reavaliar o módulo com a env nova.
  const mod = await import(`./iceConfig.ts?case=${encodeURIComponent(String(turnUrls))}`);
  return mod.ICE_CONFIG as RTCConfiguration;
}

const allUrls = (cfg: RTCConfiguration) =>
  (cfg.iceServers ?? []).flatMap((s) => (Array.isArray(s.urls) ? s.urls : [s.urls]));

// Sem TURN configurado (dev local, deploy novo): sobra só o STUN, e ele funciona.
for (const empty of [undefined, "", "   ", ",", ",,"]) {
  const cfg = await loadWith(empty);
  assert.equal(cfg.iceServers?.length, 1, `${JSON.stringify(empty)} devia deixar só o STUN`);
  assert.deepEqual(allUrls(cfg), ["stun:stun.l.google.com:19302"]);
}

// Com TURN: entra como segunda entrada, com as credenciais.
const one = await loadWith("turn:t.example.com:3478");
assert.equal(one.iceServers?.length, 2);
assert.deepEqual(one.iceServers?.[1].urls, ["turn:t.example.com:3478"]);

// Várias URLs, com espaços e vírgulas sobrando — nada vazio passa.
const many = await loadWith(" turn:a.com:3478 , , turns:b.com:5349 ,");
assert.deepEqual(many.iceServers?.[1].urls, ["turn:a.com:3478", "turns:b.com:5349"]);

for (const raw of [undefined, "", " ", ",", "turn:a.com,", " , turn:b.com"]) {
  const urls = allUrls(await loadWith(raw));
  assert.ok(urls.every((u) => typeof u === "string" && u.length > 0), `vazio vazou em ${JSON.stringify(raw)}`);
}

console.log("iceConfig: ok");
