"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  fetchAdminRooms,
  createBan,
  BAN_SUBJECT_LABELS,
  type AdminRoom,
  type AdminRoomPeer,
  type BanSubject,
} from "@/lib/adminApi";
import { DisplayUserName } from "@/components/DisplayUserName";
import { readAdminViewState, patchAdminViewState } from "./adminViewState";

const POLL_INTERVAL_MS = 5000;

function formatActiveFor(createdAt: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - createdAt) / 1000));
  if (seconds < 60) return "há poucos segundos";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `há ${minutes} ${minutes === 1 ? "minuto" : "minutos"}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} ${hours === 1 ? "hora" : "horas"}`;
  const days = Math.floor(hours / 24);
  return `há ${days} ${days === 1 ? "dia" : "dias"}`;
}

// The three ways someone can be putting something on other people's screens,
// plus the mic. "video" is not a stream of theirs at all — it's a room video
// source they added (see lib/videoSource.ts) — which is exactly why it needs
// to be told apart from the other two rather than lumped into "sharing".
type PeerFilter = "screen" | "camera" | "video" | "mic";

const FILTERS: { value: PeerFilter; label: string; activeClass: string }[] = [
  {
    value: "screen",
    label: "Tela",
    activeClass: "border-emerald-500 bg-emerald-500 text-white",
  },
  {
    value: "camera",
    label: "Câmera",
    activeClass: "border-violet-500 bg-violet-500 text-white",
  },
  {
    value: "video",
    label: "Fonte de vídeo",
    activeClass: "border-red-500 bg-red-500 text-white",
  },
  { value: "mic", label: "Microfone", activeClass: "border-sky-500 bg-sky-500 text-white" },
];

function isPeerFilter(value: string): value is PeerFilter {
  return FILTERS.some((f) => f.value === value);
}

// True when the server told us nothing about which channel this person is
// broadcasting — an outdated client only ever reports the single "sharing"
// boolean (see AdminRoomPeer.screen).
function channelUnknown(peer: AdminRoomPeer): boolean {
  return peer.sharing && peer.screen == null && peer.camera == null;
}

function peerVideoCount(peer: AdminRoomPeer): number {
  return peer.videoSources ?? 0;
}

// Every selected filter has to hold for the *same* person — "Tela" + "Microfone"
// means someone sharing their screen with the mic on, not one person doing
// each. That's the question a moderator is actually asking.
//
// A peer whose channel is unknown counts for both "screen" and "camera": it
// might be either, and over-including someone in a moderation filter is a far
// smaller problem than quietly hiding them.
function peerMatchesFilters(peer: AdminRoomPeer, filters: PeerFilter[]): boolean {
  return filters.every((filter) => {
    switch (filter) {
      case "screen":
        return peer.screen === true || channelUnknown(peer);
      case "camera":
        return peer.camera === true || channelUnknown(peer);
      case "video":
        return peerVideoCount(peer) > 0;
      case "mic":
        return peer.mic;
    }
  });
}

// What actually gets compared against every searchable field. Beyond the
// obvious trim/lowercase, this exists so a moderator can paste whatever they
// happen to have in hand instead of having to extract the id themselves:
//
//   - a profile or room URL (".../user/<id>", ".../watch/<handle>") — only
//     the last path segment is kept;
//   - an "@username" as it's written in chat — the "@" is dropped.
function normalizeQuery(raw: string): string {
  let q = raw.trim().toLowerCase();
  if (q.includes("/")) {
    const segments = q.split(/[/?#]/).filter(Boolean);
    if (segments.length > 0) q = segments[segments.length - 1];
  }
  if (q.startsWith("@")) q = q.slice(1);
  return q;
}

// Every field a person can be found by. `name` is deliberately not the only
// one: an account's display name can differ from its username, and a guest's
// name is just whatever they typed this session, so neither is a dependable
// way to locate someone — the id fields (account, guest, connection) are.
function peerMatchesQuery(peer: AdminRoomPeer, q: string): boolean {
  if (!q) return true;
  const fields = [
    peer.id,
    peer.name,
    peer.username,
    peer.accountId,
    peer.guestId,
    peer.fingerprint,
    peer.ip,
  ];
  return fields.some((f) => typeof f === "string" && f.toLowerCase().includes(q));
}

// The room's own identity, as opposed to who happens to be inside it.
function roomMatchesQuery(room: AdminRoom, q: string): boolean {
  const fields = [room.handle, room.code, room.ownerId];
  return fields.some((f) => typeof f === "string" && f.toLowerCase().includes(q));
}

// The room's owner is identified by a *stable* id (account id, else guest
// id), so it has to be compared against both — plus the connection id, which
// is the server's own last-resort fallback (see stableUserId in signaling.ts).
function isOwner(room: AdminRoom, peer: AdminRoomPeer): boolean {
  if (!room.ownerId) return false;
  return room.ownerId === peer.accountId || room.ownerId === peer.guestId || room.ownerId === peer.id;
}

function banKey(subject: BanSubject, value: string): string {
  return `${subject}:${value}`;
}

// "Banido" here means banned *by this panel, in this session* — the rooms
// endpoint doesn't say whether someone is already banned, and a ban takes
// them off the list within a poll anyway, so this only has to stop a double
// click on the button that was just used.
function BanButton({
  subject,
  value,
  bannedKeys,
  banningKey,
  onBan,
}: {
  subject: BanSubject;
  value: string;
  bannedKeys: Set<string>;
  banningKey: string | null;
  onBan: () => void;
}) {
  const key = banKey(subject, value);
  const banned = bannedKeys.has(key);
  const banning = banningKey === key;
  return (
    <button
      type="button"
      onClick={onBan}
      disabled={banned || banning}
      title={`Banir ${BAN_SUBJECT_LABELS[subject].toLowerCase()}: ${value}`}
      className="shrink-0 rounded-md border border-red-300 px-2 py-1 text-[11px] font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
    >
      {banned ? "Banido" : banning ? "Banindo..." : `Banir ${BAN_SUBJECT_LABELS[subject]}`}
    </button>
  );
}

// Wraps the matched substring in <mark> so it's obvious *why* a row came
// back: searching by id turns up rows whose visible name has nothing to do
// with what was typed, and without this the match just looks arbitrary.
function Highlight({ text, query }: { text: string; query: string }) {
  const at = query ? text.toLowerCase().indexOf(query) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded bg-amber-200 px-0.5 text-inherit dark:bg-amber-500/40">
        {text.slice(at, at + query.length)}
      </mark>
      {text.slice(at + query.length)}
    </>
  );
}

function Badge({ children, className }: { children: React.ReactNode; className: string }) {
  return (
    <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${className}`}>
      {children}
    </span>
  );
}

// One badge per thing this person is actually doing — the whole point being
// that "tela", "câmera" and "fonte de vídeo" are three different things a
// single "transmitindo" label used to hide.
function PeerActivityBadges({ peer }: { peer: AdminRoomPeer }) {
  const videoCount = peerVideoCount(peer);
  return (
    <>
      {peer.screen && (
        <Badge className="bg-emerald-600 text-white">tela</Badge>
      )}
      {peer.camera && <Badge className="bg-violet-600 text-white">câmera</Badge>}
      {channelUnknown(peer) && (
        // Sharing something, but the client is too old to say what. Labelling
        // it "tela" would be a guess, and a wrong one for every camera share.
        <Badge className="bg-zinc-500 text-white">transmitindo</Badge>
      )}
      {videoCount > 0 && (
        <Badge className="bg-red-600 text-white">
          {videoCount > 1 ? `${videoCount} vídeos` : "vídeo"}
        </Badge>
      )}
      {peer.mic && <Badge className="bg-sky-600 text-white">mic</Badge>}
    </>
  );
}

// Room-level tally of the same three activities, so a busy room can be read
// without expanding every person.
function roomSummary(room: AdminRoom): string[] {
  const parts: string[] = [];
  const screens = room.peers.filter((p) => p.screen || channelUnknown(p)).length;
  const cameras = room.peers.filter((p) => p.camera).length;
  const videos = room.videoSourceCount ?? room.peers.reduce((sum, p) => sum + peerVideoCount(p), 0);
  const mics = room.peers.filter((p) => p.mic).length;
  if (screens > 0) parts.push(`${screens} ${screens === 1 ? "tela" : "telas"}`);
  if (cameras > 0) parts.push(`${cameras} ${cameras === 1 ? "câmera" : "câmeras"}`);
  if (videos > 0) parts.push(`${videos} ${videos === 1 ? "vídeo" : "vídeos"}`);
  if (mics > 0) parts.push(`${mics} ${mics === 1 ? "mic" : "mics"}`);
  return parts;
}

export function ModerationPanel() {
  const [rooms, setRooms] = useState<AdminRoom[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Search and filters are restored from the stored view state so returning
  // from a room in moderation mode lands on exactly the list that was left
  // behind (see adminViewState.ts). Lazy initializers are safe here: this
  // panel only ever mounts after hydration, once there's an admin token.
  const [search, setSearch] = useState(() => readAdminViewState().search ?? "");
  const [filters, setFilters] = useState<PeerFilter[]>(
    () => readAdminViewState().filters?.filter(isPeerFilter) ?? []
  );
  // Keyed by subject+value rather than by value alone: the same person now
  // has three separately-bannable handles, and banning their IP shouldn't
  // grey out the account button next to it.
  const [banningKey, setBanningKey] = useState<string | null>(null);
  const [bannedKeys, setBannedKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function load() {
      try {
        const data = await fetchAdminRooms(controller.signal);
        if (cancelled) return;
        setRooms(data);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        // A 401 already cleared the stored token inside fetchAdminRooms —
        // useAdminToken (in the parent page) picks that up on its own and
        // this whole effect re-runs, no local state to reset here.
        if (err instanceof Error && err.message === "unauthorized") return;
        setError("Não foi possível carregar as salas.");
      }
    }

    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(interval);
    };
  }, []);

  // Scroll is restored once, on the first render that actually has the list
  // in it — before the rooms land there's nothing tall enough to scroll to.
  // Only once, too: a later poll must never yank the page from under someone
  // who has since scrolled somewhere else.
  const scrollRestored = useRef(false);
  useEffect(() => {
    if (scrollRestored.current || rooms === null) return;
    scrollRestored.current = true;
    const { scrollY } = readAdminViewState();
    if (scrollY) window.scrollTo({ top: scrollY });
  }, [rooms]);

  function updateSearch(value: string) {
    setSearch(value);
    patchAdminViewState({ search: value });
  }

  function toggleFilter(filter: PeerFilter) {
    setFilters((prev) => {
      const next = prev.includes(filter) ? prev.filter((f) => f !== filter) : [...prev, filter];
      patchAdminViewState({ filters: next });
      return next;
    });
  }

  function clearFilters() {
    setFilters([]);
    patchAdminViewState({ filters: [] });
  }

  async function handleBanPeer(subject: BanSubject, value: string, roomHandle: string) {
    const label = BAN_SUBJECT_LABELS[subject];
    if (
      !window.confirm(
        `Banir por ${label.toLowerCase()} (${value})? A pessoa será desconectada imediatamente.`
      )
    ) {
      return;
    }
    const key = banKey(subject, value);
    setBanningKey(key);
    try {
      await createBan({ subject, value, reason: `Banido a partir da sala ${roomHandle}` });
      setBannedKeys((prev) => new Set(prev).add(key));
    } catch (err) {
      setError(err instanceof Error ? err.message : `Falha ao banir por ${label.toLowerCase()}.`);
    } finally {
      setBanningKey(null);
    }
  }

  const query = normalizeQuery(search);

  const filtered = useMemo(() => {
    const all = rooms ?? [];
    if (!query && filters.length === 0) return all;
    const peerHits = (room: AdminRoom) =>
      room.peers.filter((p) => peerMatchesQuery(p, query) && peerMatchesFilters(p, filters));
    return (
      all
        .filter((room) => {
          // With a filter on, the answer has to be a *person* doing that
          // thing — a room whose handle merely looks like the query has
          // nobody sharing a camera just because it's called "camera".
          if (filters.length > 0) return peerHits(room).length > 0;
          return roomMatchesQuery(room, query) || peerHits(room).length > 0;
        })
        // Rooms found through someone inside them come first: when the search
        // is a person, that's the answer being looked for, and a room that
        // merely has a similar handle shouldn't sit on top of it.
        .sort((a, b) => (peerHits(a).length > 0 ? 0 : 1) - (peerHits(b).length > 0 ? 0 : 1))
    );
  }, [rooms, query, filters]);

  const hasQuery = query.length > 0 || filters.length > 0;

  return (
    <div>
      <input
        value={search}
        onChange={(e) => updateSearch(e.target.value)}
        placeholder="Pesquisar por sala, pessoa, @usuário, id ou IP..."
        className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
      />
      <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
        Encontra salas públicas e privadas pelo nome da sala, código de acesso, nome de convidado,
        nome de usuário, id da conta, id de convidado, id de conexão ou IP. Também aceita um link de
        perfil ou de sala colado inteiro.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {FILTERS.map((f) => {
          const active = filters.includes(f.value);
          return (
            <button
              key={f.value}
              type="button"
              onClick={() => toggleFilter(f.value)}
              aria-pressed={active}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                active
                  ? f.activeClass
                  : "border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
              }`}
            >
              {f.label}
            </button>
          );
        })}
        {filters.length > 0 && (
          <button
            type="button"
            onClick={clearFilters}
            className="ml-1 text-xs font-medium text-zinc-500 underline underline-offset-2 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            Limpar filtros
          </button>
        )}
      </div>
      {filters.length > 1 && (
        <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
          Mostrando salas onde a <strong className="font-medium">mesma pessoa</strong> atende a
          todos os filtros selecionados.
        </p>
      )}

      <div className="mt-6">
        {error && (
          <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400">
            {error}
          </p>
        )}

        {!error && rooms === null && (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Carregando...</p>
        )}

        {!error && rooms !== null && filtered.length === 0 && (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {rooms.length === 0 ? "Nenhuma sala ativa no momento." : "Nenhuma sala encontrada."}
          </p>
        )}

        {!error && hasQuery && filtered.length > 0 && (
          <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
            {filtered.length} {filtered.length === 1 ? "sala encontrada" : "salas encontradas"} de{" "}
            {(rooms ?? []).length}.
          </p>
        )}

        <ul className="flex flex-col gap-3">
          {filtered.map((room) => {
            const summary = roomSummary(room);
            return (
              <li
                key={room.handle}
                className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-semibold text-zinc-900 dark:text-zinc-100">
                        <Highlight text={room.handle} query={query} />
                      </p>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium text-white ${
                          room.isPrivate ? "bg-red-600" : "bg-emerald-600"
                        }`}
                      >
                        {room.isPrivate ? "privada" : "pública"}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                      {room.peopleCount} {room.peopleCount === 1 ? "pessoa" : "pessoas"} · ativa{" "}
                      {formatActiveFor(room.createdAt)}
                      {summary.length > 0 && ` · ${summary.join(" · ")}`}
                      {room.code && (
                        <>
                          {" · código "}
                          <span className="font-mono">
                            <Highlight text={room.code} query={query} />
                          </span>
                        </>
                      )}
                    </p>
                  </div>
                  <Link
                    href={`/admin/room/${room.handle}`}
                    // Remembers how far down the list this room was, so
                    // "Parar de visualizar" comes back to this exact row
                    // instead of the top (see adminViewState.ts). The tab goes
                    // with it: whoever opens a room from here was on the
                    // moderation tab by definition, even if they never
                    // clicked it themselves this session.
                    onClick={() =>
                      patchAdminViewState({ scrollY: window.scrollY, tab: "moderation" })
                    }
                    className="shrink-0 rounded-lg bg-zinc-950 px-3 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
                  >
                    Visualizar
                  </Link>
                </div>
                {room.peers.length > 0 && (
                  <ul className="mt-3 flex flex-col gap-1.5">
                    {room.peers.map((p) => {
                      const matched =
                        hasQuery && peerMatchesQuery(p, query) && peerMatchesFilters(p, filters);
                      const owner = isOwner(room, p);
                      return (
                        <li
                          key={p.id}
                          className={`flex flex-wrap items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-xs text-zinc-600 dark:text-zinc-400 ${
                            matched
                              ? "bg-amber-50 ring-1 ring-amber-300 dark:bg-amber-950/30 dark:ring-amber-700"
                              : "bg-zinc-100 dark:bg-zinc-900"
                          }`}
                        >
                          <span className="min-w-0">
                            <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                              <DisplayUserName name={p.name ?? "sem nome"} isGuest={p.isGuest} />
                              {owner && (
                                <Badge className="bg-zinc-300 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200">
                                  dono
                                </Badge>
                              )}
                              <PeerActivityBadges peer={p} />
                            </span>
                            {/* Second line: the identifiers the search above
                                matches on. Always shown, not only on a hit, so
                                a moderator can copy one out of a room they got
                                to some other way. */}
                            <span className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 font-mono text-[11px] text-zinc-400 dark:text-zinc-500">
                              {p.username && (
                                <span>
                                  @<Highlight text={p.username} query={query} />
                                </span>
                              )}
                              {p.accountId ? (
                                <Link
                                  href={`/user/${p.accountId}`}
                                  className="underline decoration-dotted underline-offset-2 transition hover:text-zinc-600 dark:hover:text-zinc-300"
                                >
                                  <Highlight text={p.accountId} query={query} />
                                </Link>
                              ) : (
                                p.guestId && (
                                  <span>
                                    <Highlight text={p.guestId} query={query} />
                                  </span>
                                )
                              )}
                              <span>
                                conn <Highlight text={p.id} query={query} />
                              </span>
                              {p.fingerprint && (
                                <span>
                                  fp <Highlight text={p.fingerprint} query={query} />
                                </span>
                              )}
                              <span>
                                <Highlight text={p.ip} query={query} />
                              </span>
                            </span>
                          </span>
                          {/* One button per handle this person can be
                              banned on. An IP ban alone is the weakest of the
                              three — shared behind a CGNAT, and reassigned on
                              its own on mobile data — so the account and the
                              browser fingerprint sit right next to it, each
                              offered only when that handle actually exists
                              for this peer. */}
                          <span className="flex shrink-0 flex-wrap gap-1">
                            <BanButton
                              subject="ip"
                              value={p.ip}
                              bannedKeys={bannedKeys}
                              banningKey={banningKey}
                              onBan={() => handleBanPeer("ip", p.ip, room.handle)}
                            />
                            {p.accountId && (
                              <BanButton
                                subject="account"
                                value={p.accountId}
                                bannedKeys={bannedKeys}
                                banningKey={banningKey}
                                onBan={() => handleBanPeer("account", p.accountId!, room.handle)}
                              />
                            )}
                            {p.fingerprint && (
                              <BanButton
                                subject="fingerprint"
                                value={p.fingerprint}
                                bannedKeys={bannedKeys}
                                banningKey={banningKey}
                                onBan={() =>
                                  handleBanPeer("fingerprint", p.fingerprint!, room.handle)
                                }
                              />
                            )}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
