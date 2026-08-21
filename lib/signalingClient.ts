"use client";

import { trackEvent } from "./analytics";
import type { Announcement } from "./announcement";
import type { Partner } from "./partner";
import { getAccountToken } from "./accountApi";
import { getTurnstileToken } from "./turnstile";

// `role: "moderator"` marks a moderator silently watching for moderation
// (see server/signaling.ts's "admin-join") — present in the peer list so
// this client's own useRoomMedia still opens a WebRTC connection to it like
// any other peer, but the UI (WatchRoom) filters it out of what's shown.
export type PeerInfo = {
  id: string;
  name: string;
  sharing: boolean;
  mic: boolean;
  role?: "moderator";
  // Stable per-account/per-guest identity (see server/signaling.ts's
  // stableUserId) — unlike `id`, which is reissued on every reconnect, this
  // stays the same across reloads for the same person. Undefined only for a
  // peer sent by an older server version that doesn't send it yet.
  userId?: string;
  // Not logged into a registered account (see server/signaling.ts's
  // peerSummary) — every name-displaying UI (ParticipantRow, VideoTile
  // labels, ChatPanel) renders this as a "(guest)" suffix via
  // lib/displayName.ts. Undefined only for a peer sent by an older server
  // version that doesn't send it yet — treated the same as `false`.
  isGuest?: boolean;
  // Account flags (e.g. "VERIFIED") — see RegisteredAccount.flags below.
  // Undefined for a guest, or a peer sent by an older server version that
  // doesn't include this yet; DisplayUserName treats both the same (no
  // badge). Only ever meaningful for a real account, never a guest name.
  flags?: string[];
};

export type SignalingStatus = "idle" | "connecting" | "open" | "closed" | "superseded" | "banned";

export type ChatMessage = {
  id: string;
  from: string;
  name: string;
  // See PeerInfo.isGuest's doc comment — captured per-message at send time
  // (see server/signaling.ts's "chat" handler), same as `name`.
  isGuest?: boolean;
  // See PeerInfo.flags's doc comment.
  flags?: string[];
  // Missing/anything other than "gif" (including messages persisted before
  // this field existed) renders as plain text.
  kind?: "text" | "gif";
  text: string;
  url?: string;
  ts: number;
};

// Echoed back by the server on "registered" (see server/signaling.ts) when
// this connection presented a valid account JWT — null for a guest.
export type RegisteredAccount = {
  username: string;
  flags: string[];
};

export type SignalingState = {
  status: SignalingStatus;
  selfId: string | null;
  name: string | null;
  nameError: string | null;
  account: RegisteredAccount | null;
  room: string | null;
  // Set when the last "join" attempt failed for a reason that isn't a fresh
  // retry away: either the server rejected it outright because someone
  // else — a provably different guest/account, not just another connection
  // of ours — already holds this display name in that specific room (see
  // server/signaling.ts's "join" handler and the "join-error" case below),
  // or performJoin's turnstile verification kept getting rejected past
  // MAX_JOIN_RETRIES. Cleared as soon as a room is actually entered or a
  // fresh join attempt starts. Distinct from nameError: that one is about
  // the name itself (format, or reserved by an account) and can block
  // before a room is even chosen; this one only ever happens once a room
  // was targeted.
  peers: PeerInfo[];
  chatMessages: ChatMessage[];
  // Site-wide banner, independent of room — null when none is active. Set
  // from the server's "announcement" push (see server/signaling.ts's
  // broadcastToAll), which also fires once right after "welcome" for a
  // fresh connection so a page opened while one's active still sees it
  // (only when the announcement's visibility is "all" — see the server).
  announcement: Announcement | null;
  // Whether the *most recent* "announcement" delivery was a live one (this
  // connection was already open when it was sent/edited) rather than a
  // catch-up delivery to a freshly opened connection — mirrors the
  // server's `live` flag on that message. Read alongside `announcement` by
  // AnnouncementBanner.tsx to decide whether to play the "live-only" sound.
  announcementLive: boolean;
  // Bumped every time an "announcement" message is actually processed
  // (whatever its value, including a clear). A "visibility: online-only"
  // announcement is, *by design*, never pushed to a fresh connection at
  // all (see the server), so `announcement` can legitimately stay `null`
  // here forever even while one is genuinely active — this counter is what
  // lets AnnouncementBanner.tsx's localStorage fallback tell "nothing's
  // arrived yet, so I don't actually know" apart from "a message arrived
  // and it said null," which is the only case that should make it drop its
  // cached persistent announcement.
  announcementSeq: number;
  // Sidebar partner-ad slot (see components/PartnerCard.tsx and
  // server/signaling.ts's broadcastPartnerUpdate) — unlike `announcement`,
  // this is *never* pushed automatically on connect; PartnerCard.tsx always
  // fetches its initial value over plain HTTP (GET /partner, which is where
  // the "show nothing X% of the time" roll happens) and only uses this for
  // *live* updates while already mounted. `partnerSeq` (mirrors
  // announcementSeq) is what lets it tell "no live update has arrived, keep
  // showing what HTTP gave me" apart from "a live update arrived and it
  // said null" — both look identical as a bare `partner: null` otherwise.
  partner: Partner | null;
  partnerSeq: number;
  // Set when the server rejected our last chat message for containing a
  // banned word (see server/signaling.ts's "chat-blocked") — cleared as
  // soon as another send is attempted, so it's a one-shot warning rather
  // than a persistent banner.
  chatBlockedMessage: string | null;
  joinError: string | null;
};

type Listener = () => void;
type SignalListener = (from: string, data: Record<string, unknown>) => void;

const WS_URL = process.env.NEXT_PUBLIC_SIGNALING_URL || "ws://localhost:4000/ws";
const NAME_STORAGE_KEY = "sharescreen:name";
// A guest identity token (see server/signaling.ts's "register" handler) —
// unlike the clientId below, this is meant to follow the guest around
// everywhere (every tab, every reload) since it's what proves "this is
// still the same guest" without ever being exposed to anyone else, so it's
// kept in localStorage rather than sessionStorage.
const GUEST_TOKEN_STORAGE_KEY = "sharescreen:guestToken";
// Deliberately sessionStorage, not localStorage: this id is echoed to every
// peer in whatever room it's used in (see peerSummary/room-state on the
// server), so it must stay scoped to *this tab* rather than being shared
// browser-wide — otherwise a second tab opened for a different room would
// immediately steal it back and forth with the first (see
// SUPERSEDED_CLOSE_CODE below), even though the two tabs have nothing to do
// with each other. A reload of this same tab still reclaims it, since
// sessionStorage survives that; a brand new tab simply starts fresh.
const CLIENT_ID_STORAGE_KEY = "sharescreen:clientId";
// Mirrors server/signaling.ts's SUPERSEDED_CLOSE_CODE.
const SUPERSEDED_CLOSE_CODE = 4000;
// Mirrors server/signaling.ts's BANNED_CLOSE_CODE.
const BANNED_CLOSE_CODE = 4003;

const initialState: SignalingState = {
  status: "idle",
  selfId: null,
  name: null,
  nameError: null,
  account: null,
  room: null,
  joinError: null,
  peers: [],
  chatMessages: [],
  announcement: null,
  announcementLive: false,
  announcementSeq: 0,
  partner: null,
  partnerSeq: 0,
  chatBlockedMessage: null,
};

// How many times performJoin auto-retries after a "turnstile-required"
// rejection (fetching a fresh token each time) before giving up and
// surfacing joinError instead — covers a token expiring in flight or one bad
// verification call without retrying forever if Turnstile is genuinely
// broken (blocked by an extension, network issue, misconfigured site key).
const MAX_JOIN_RETRIES = 3;
// Mirrors server/signaling.ts's TURNSTILE_REVERIFY_INTERVAL_MS — purely an
// optimization to skip a pointless getTurnstileToken() call once the server
// would reject a stale connection-level verification anyway; the server is
// the actual source of truth (a mismatch here just costs one extra
// "turnstile-required" round trip, already handled by performJoin's retry).
const TURNSTILE_REVERIFY_INTERVAL_MS = 10 * 60_000;

// Cap on retained chat history per room, to keep memory bounded in a
// long-running room instead of growing the array forever.
const MAX_CHAT_MESSAGES = 200;

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

// A stable per-tab connection id, persisted across reloads and reconnects
// of *this tab* (including after the signaling server itself restarts for a
// deploy) so a returning client can reclaim its previous identity instead
// of showing up as a stranger — which would otherwise orphan everyone
// else's still-open WebRTC connections to it. The server adopts whatever id
// we send it once registered, so this also self-heals if it's ever out of
// sync. sessionStorage (not localStorage) deliberately keeps this scoped to
// one tab — see CLIENT_ID_STORAGE_KEY above.
function getClientId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(CLIENT_ID_STORAGE_KEY);
  } catch {
    return null;
  }
}

function setClientId(id: string) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(CLIENT_ID_STORAGE_KEY, id);
  } catch {
    // ignored - sessionStorage may be unavailable (private mode, quota, etc.)
  }
}

// The guest identity token handed back by "registered" (see
// server/signaling.ts) the first time a connection shows up without one —
// null once logged into an account (accountApi's own token takes over) or
// before this browser has ever registered as a guest at all.
function getStoredGuestToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(GUEST_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function setStoredGuestToken(token: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(GUEST_TOKEN_STORAGE_KEY, token);
  } catch {
    // ignored - localStorage may be unavailable (private mode, quota, etc.)
  }
}

class SignalingClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private signalListeners = new Set<SignalListener>();
  private roomJoinedListeners = new Set<Listener>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private desiredName: string | null = null;
  // The account JWT to (re)send with every "register" — null for a guest.
  // Kept alongside desiredName so a reconnect re-authenticates the same way
  // the original register() call did.
  private desiredToken: string | null = null;
  private desiredRoom: string | null = null;
  // Consecutive "turnstile-required" rejections for the current join
  // attempt — see MAX_JOIN_RETRIES and performJoin.
  private joinRetryCount = 0;
  // Mirrors ClientInfo.turnstileVerifiedAt in server/signaling.ts: once a
  // join on the current socket has been accepted with a valid token, later
  // joins (room switches) within TURNSTILE_REVERIFY_INTERVAL_MS skip
  // fetching a new token entirely — the server remembers this connection
  // passed recently too. Reset to null every time a new WebSocket is opened
  // (see ensureSocket), since a fresh connection is always unverified
  // server-side too.
  private turnstileVerifiedAt: number | null = null;
  // Set by connect() below — lets a connection stay open (and reconnect
  // after a drop, see scheduleReconnect) purely to receive site-wide pushes
  // like the announcement banner, for a visitor who hasn't registered a name
  // yet and so has no desiredName of their own.
  private wantsConnection = false;

  state: SignalingState = initialState;

  constructor() {
    // A stored account token takes over identity entirely — page.tsx
    // resolves it to the account's display name (via accountApi.fetchMe)
    // and calls register(name, token) itself, so auto-registering from the
    // plain guest name here would just get immediately overwritten (or
    // rejected as a name reserved by that very account).
    if (getAccountToken()) return;
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

  // Fires every time room-state is received, including after a reconnect
  // rejoins the same room — lets media channels re-announce sharing/mic
  // state, which the server resets to false for the new socket.
  onRoomJoined(cb: Listener) {
    this.roomJoinedListeners.add(cb);
    return () => this.roomJoinedListeners.delete(cb);
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
    this.turnstileVerifiedAt = null;
    const ws = new WebSocket(WS_URL);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.setState({ status: "open" });
      if (this.desiredName) {
        this.rawSend({
          type: "register",
          name: this.desiredName,
          clientId: getClientId(),
          token: this.desiredToken,
        });
      }
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

    ws.onclose = (event) => {
      // Deliberately keep the last-known room/peers instead of blanking
      // them: the underlying WebRTC connections to those peers are
      // untouched by a brief signaling hiccup, so wiping the list here
      // made participants (and their sharing/mic dots) flicker away and
      // reappear even though their audio/video never actually stopped.
      // Once we reconnect, a fresh room-state reconciles anything that's
      // genuinely stale (see the pruning in useRoomMedia's onRoomJoined).
      // Code 4000 (see server/signaling.ts's detachSession) means another
      // connection — a second tab, or a reload that briefly overlapped the
      // old connection — just reclaimed this exact clientId. Reconnecting
      // would only reclaim it right back, kicking that one instead: without
      // this check the two sockets alternate forever, each resetting its
      // own backoff every time it briefly wins, never settling. Surface it
      // as a distinct status instead of "closed" so the UI can tell the
      // user what happened rather than looking like it's stuck reconnecting.
      if (event.code === SUPERSEDED_CLOSE_CODE) {
        this.setState({ status: "superseded" });
        return;
      }
      // Mirrors the superseded case above: reconnecting would just get
      // rejected again immediately (the ban is checked on every "/ws"
      // upgrade), so stop retrying and surface it instead of looking stuck.
      if (event.code === BANNED_CLOSE_CODE) {
        this.desiredName = null;
        this.setState({ status: "banned" });
        return;
      }
      this.setState({ status: "closed" });
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      ws.close();
    };
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || (!this.desiredName && !this.wantsConnection)) return;
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
      case "registered": {
        const account = (msg.account as RegisteredAccount | null) ?? null;
        const guestToken = typeof msg.guestToken === "string" ? msg.guestToken : null;
        // A guest identity token is only ever sent when the server minted a
        // new one for us (see server/signaling.ts) — persist it and start
        // presenting it on every future register() so this guest can prove
        // it's still the same one (that's what lets a reload or a second
        // tab reclaim its spot without some other request being able to
        // impersonate it — see isSameOwner server-side).
        let justMintedGuestToken = false;
        if (!account && guestToken) {
          setStoredGuestToken(guestToken);
          this.desiredToken = guestToken;
          justMintedGuestToken = true;
        }
        this.setState({
          name: msg.name as string,
          nameError: null,
          selfId: msg.id as string,
          account,
        });
        // A guest's name is remembered locally so it can be restored on
        // the next visit; an account's isn't, since accountApi's own
        // stored token is what drives auto-login next time (see the
        // constructor above) and re-persisting it here would just leave a
        // stale guest name behind after a logout.
        if (!account) setStoredName(msg.name as string);
        setClientId(msg.id as string);
        trackEvent("name_registered");
        // A freshly minted guest token only protects this connection once
        // the server has actually seen it presented back (see isSameOwner
        // and "registered"/"join" server-side) — until then someone who
        // observes this connection's id/name from a room's peer list could
        // still claim it the old (unprotected) way. Immediately presenting
        // it back on this same connection, rather than waiting for the next
        // natural reconnect, closes that window down to one round trip
        // instead of leaving it open for as long as this tab stays open.
        if (justMintedGuestToken) {
          this.rawSend({ type: "register", name: msg.name, clientId: getClientId(), token: guestToken });
        }
        // A fresh registration (initial connect, or reconnect) counts as a
        // new join attempt — reset the retry budget rather than carrying
        // over count from whatever happened before the connection dropped.
        if (this.desiredRoom) {
          this.joinRetryCount = 0;
          void this.performJoin(this.desiredRoom);
        }
        break;
      }
      case "register-error":
        this.setState({ nameError: msg.message as string });
        // If we already had a confirmed name, this was a rename attempt —
        // fall back to it instead of abandoning an otherwise-working
        // session (which would also stop future reconnects from
        // re-registering at all, since desiredName would be null).
        if (this.state.name) {
          this.desiredName = this.state.name;
        } else {
          this.desiredName = null;
          this.desiredToken = null;
          setStoredName(null);
        }
        trackEvent("name_register_error");
        break;
      // The name we hold is already taken by a provably different
      // guest/account in the room we just tried to join (see
      // server/signaling.ts's "join" handler) — surfaced separately from
      // register-error since, unlike that one, our name registration itself
      // was fine; only entering *this* room failed.
      case "join-error":
        this.desiredRoom = null;
        this.setState({ joinError: (msg.message as string) ?? "Não foi possível entrar nesta sala." });
        trackEvent("join_error");
        break;
      case "room-state": {
        // The server sends the room's full retained chat history (kept for
        // the room's lifetime — see server/signaling.ts) on every join,
        // including a room switch, so a newcomer sees what was said before
        // they arrived.
        const history = Array.isArray(msg.messages) ? (msg.messages as ChatMessage[]) : [];
        this.joinRetryCount = 0;
        this.turnstileVerifiedAt = Date.now();
        this.setState({
          room: msg.room as string,
          selfId: msg.selfId as string,
          joinError: null,
          peers: msg.peers as PeerInfo[],
          chatMessages:
            history.length > MAX_CHAT_MESSAGES ? history.slice(-MAX_CHAT_MESSAGES) : history,
        });
        trackEvent("room_joined");
        this.roomJoinedListeners.forEach((l) => l());
        break;
      }
      // The server's server/turnstile.ts rejected (or never received) a
      // valid challenge token for our last "join" — see performJoin, which
      // fetches a fresh token per attempt since each one is single-use.
      case "turnstile-required": {
        if (!this.desiredRoom) break;
        this.joinRetryCount += 1;
        if (this.joinRetryCount > MAX_JOIN_RETRIES) {
          this.setState({
            joinError: (msg.message as string) ?? "Não foi possível verificar a segurança da sala.",
          });
          break;
        }
        void this.performJoin(this.desiredRoom);
        break;
      }
      case "peer-joined": {
        // Idempotent by id: a peer that reclaimed its identity after a
        // reconnect can legitimately "join" again while still listed (its
        // stale departure isn't announced, to avoid tearing down otherwise
        // still-healthy WebRTC connections over a brief signaling hiccup).
        const alreadyKnown = this.state.peers.some((p) => p.id === msg.id);
        const role = msg.role === "moderator" ? "moderator" : undefined;
        const userId = typeof msg.userId === "string" ? msg.userId : undefined;
        const isGuest = Boolean(msg.isGuest);
        const flags = Array.isArray(msg.flags) ? (msg.flags as string[]) : undefined;
        this.setState({
          peers: alreadyKnown
            ? this.state.peers.map((p) =>
                p.id === msg.id
                  ? { ...p, name: msg.name as string, sharing: false, mic: false, role, userId, isGuest, flags }
                  : p
              )
            : [
                ...this.state.peers,
                { id: msg.id as string, name: msg.name as string, sharing: false, mic: false, role, userId, isGuest, flags },
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
        this.signalListeners.forEach((l) =>
          l(msg.from as string, msg.data as Record<string, unknown>)
        );
        break;
      case "announcement":
        this.setState({
          announcement: (msg.announcement as Announcement | null) ?? null,
          announcementLive: Boolean(msg.live),
          announcementSeq: this.state.announcementSeq + 1,
        });
        break;
      case "partner":
        this.setState({
          partner: (msg.partner as Partner | null) ?? null,
          partnerSeq: this.state.partnerSeq + 1,
        });
        break;
      case "chat-blocked":
        this.setState({ chatBlockedMessage: (msg.message as string) ?? "Mensagem bloqueada." });
        break;
      case "chat-message": {
        const chatMessage: ChatMessage = {
          id: msg.id as string,
          from: msg.from as string,
          name: msg.name as string,
          isGuest: Boolean(msg.isGuest),
          flags: Array.isArray(msg.flags) ? (msg.flags as string[]) : undefined,
          kind: msg.kind === "gif" ? "gif" : "text",
          text: (msg.text as string) ?? "",
          url: typeof msg.url === "string" ? msg.url : undefined,
          ts: msg.ts as number,
        };
        const next = [...this.state.chatMessages, chatMessage];
        this.setState({
          chatMessages: next.length > MAX_CHAT_MESSAGES ? next.slice(-MAX_CHAT_MESSAGES) : next,
        });
        break;
      }
      default:
        break;
    }
  }

  private rawSend(msg: unknown) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  // Opens (and, unlike a bare connection made only as a side effect of
  // register(), keeps reconnecting — see wantsConnection/scheduleReconnect)
  // a connection with no name/room attached — used by AnnouncementBanner.tsx
  // so even a brand new visitor who hasn't registered a name yet still opens
  // a socket and can receive the site-wide announcement push. A no-op if a
  // connection is already open/connecting or about to be, e.g. because
  // register() already ran.
  connect() {
    this.wantsConnection = true;
    this.ensureSocket();
  }

  // `token` is an account JWT (see accountApi.ts) — pass it when
  // registering as a logged-in account so the server can verify the
  // reserved-name check against the right owner (and, as of the account
  // name lock, so the room display name comes from the account record
  // instead of `name`). Omit it entirely (leave it `undefined`) to keep
  // using whatever token is already active for this connection — an
  // account token if one's in play (e.g. the "superseded" screen's "Usar
  // esta aba" button, which only ever passes a name), otherwise whatever
  // guest token this browser was previously issued, so a returning guest
  // keeps proving it's the same one instead of looking like a stranger on
  // every reconnect. Pass `null` explicitly to drop the current identity
  // and force a brand new guest one instead.
  register(name: string, token?: string | null) {
    this.desiredName = name;
    this.desiredToken = token !== undefined ? token : this.desiredToken ?? getStoredGuestToken();
    this.reconnectAttempts = 0;
    this.setState({ nameError: null, joinError: null });
    const wasOpen = this.ws && this.ws.readyState === WebSocket.OPEN;
    this.ensureSocket();
    if (wasOpen) {
      this.rawSend({ type: "register", name, clientId: getClientId(), token: this.desiredToken });
    }
  }

  // Drops the current identity (guest name or account) entirely and closes
  // the connection — used when someone logs out of their account, so the
  // next register() (as a guest, or a different account) starts clean
  // instead of the old name/room lingering in state.
  logoutIdentity() {
    this.desiredName = null;
    this.desiredToken = null;
    this.desiredRoom = null;
    setStoredName(null);
    this.ws?.close();
    this.ws = null;
    this.setState({ ...initialState });
  }

  joinRoom(room: string) {
    this.desiredRoom = room;
    this.joinRetryCount = 0;
    this.setState({ joinError: null });
    if (this.state.name) void this.performJoin(room);
  }

  // Fetches a fresh Turnstile token (single-use — see lib/turnstile.ts) and
  // sends the actual "join". Split out from joinRoom() so both the public
  // entry point and the "turnstile-required" retry path (see
  // handleMessage) go through the exact same token-fetch-then-send flow.
  private async performJoin(room: string) {
    // Verified recently on this socket (see room-state above) — the server
    // remembers too (ClientInfo.turnstileVerifiedAt) and won't ask again
    // within the same window, so skip bothering the widget for a token it'll
    // just ignore.
    const stillFresh =
      this.turnstileVerifiedAt !== null &&
      Date.now() - this.turnstileVerifiedAt < TURNSTILE_REVERIFY_INTERVAL_MS;
    const turnstileToken = stillFresh ? null : await getTurnstileToken();
    // Bail if the desired room or our identity changed while the token
    // fetch was in flight (room switch, logout, disconnect) — sending a
    // stale join here would either land in the wrong room or get rejected
    // anyway since the socket/name it was meant for is gone.
    if (this.desiredRoom !== room || !this.state.name) return;
    this.rawSend({ type: "join", room, turnstileToken });
  }

  leaveRoom() {
    this.desiredRoom = null;
    this.rawSend({ type: "leave" });
    this.setState({ room: null, peers: [], chatMessages: [], joinError: null });
  }

  setSharing(sharing: boolean) {
    this.rawSend({ type: "sharing", sharing });
  }

  setMic(mic: boolean) {
    this.rawSend({ type: "mic", mic });
  }

  sendSignal(to: string, data: unknown) {
    this.rawSend({ type: "signal", to, data });
  }

  sendChatMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.setState({ chatBlockedMessage: null });
    this.rawSend({ type: "chat", text: trimmed });
  }

  sendGif(url: string) {
    const trimmed = url.trim();
    if (!trimmed) return;
    this.rawSend({ type: "chat", kind: "gif", url: trimmed });
  }

  // Real engagement signals for the admin panel's live announcement stats
  // (see server/signaling.ts's announcementStats) — AnnouncementBanner.tsx
  // is the only caller, and only for whatever announcement it's actually
  // displaying right now.
  reportAnnouncementView(id: string) {
    this.rawSend({ type: "announcement-view", id });
  }

  reportAnnouncementButtonClick(id: string) {
    this.rawSend({ type: "announcement-button-click", id });
  }

  reportAnnouncementXClick(id: string) {
    this.rawSend({ type: "announcement-x-click", id });
  }

  // Same reasoning as the announcement-* reporters above, for the sidebar
  // partner-ad slot — see PartnerCard.tsx.
  reportPartnerView(id: string) {
    this.rawSend({ type: "partner-view", id });
  }

  reportPartnerClick(id: string) {
    this.rawSend({ type: "partner-click", id });
  }
}

export const signalingClient = new SignalingClient();
