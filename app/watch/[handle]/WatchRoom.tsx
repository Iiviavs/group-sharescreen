"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signalingClient } from "@/lib/signalingClient";
import { useSignaling, useHasStoredName } from "@/lib/useSignaling";
import {
  useRoomMedia,
  useScreenShareMode,
  SHARE_RESOLUTION_OPTIONS,
  SHARE_FPS_OPTIONS,
  SHARE_BITRATE_OPTIONS,
} from "@/lib/useRoomMedia";
import { trackEvent } from "@/lib/analytics";
import { toRoomHandle, isPrivateRoomHandle } from "@/lib/roomsApi";
import { VideoTile } from "@/components/VideoTile";
import { RemoteAudio } from "@/components/RemoteAudio";
import { ParticipantRow } from "@/components/ParticipantRow";
import { ChatPanel } from "@/components/ChatPanel";
import {
  MicIcon,
  MicOffIcon,
  HeadphonesIcon,
  HeadphonesOffIcon,
  NoiseSuppressionIcon,
  NoiseSuppressionOffIcon,
  LinkIcon,
  CheckIcon,
} from "@/components/icons";

const HANDLE_RE = /^[a-zA-Z0-9_-]+$/;

export function WatchRoom({ handle }: { handle: string }) {
  const router = useRouter();
  const state = useSignaling();
  const hasStoredName = useHasStoredName();
  const validHandle = HANDLE_RE.test(handle);
  const screenShareMode = useScreenShareMode();

  const {
    isSharing,
    startShare,
    stopShare,
    localStream,
    remoteStreams,
    shareError,
    shareSource,
    shareResolution,
    setShareResolution,
    shareFps,
    setShareFps,
    shareBitrate,
    setShareBitrate,
    isMicOn,
    toggleMic,
    micError,
    localMicStream,
    remoteMicStreams,
    noiseSuppressionOn,
    noiseSuppressionAvailable,
    toggleNoiseSuppression,
  } = useRoomMedia(handle);

  const [switching, setSwitching] = useState(false);
  const [switchInput, setSwitchInput] = useState("");
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [switchIsPrivate, setSwitchIsPrivate] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [micsMuted, setMicsMuted] = useState(false);
  const [mutedPeerIds, setMutedPeerIds] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState(false);
  const [renameInput, setRenameInput] = useState("");
  const [linkCopied, setLinkCopied] = useState(false);
  const previousNameRef = useRef(state.name);

  // Closes the rename popover once the name actually changes — covers both
  // success (server confirmed the new name) and a plain reconnect, without
  // needing to guess at exact timing.
  useEffect(() => {
    if (renaming && state.name !== previousNameRef.current) {
      setRenaming(false);
      setRenameInput("");
    }
    previousNameRef.current = state.name;
  }, [state.name, renaming]);

  function toggleMicsMuted() {
    const next = !micsMuted;
    setMicsMuted(next);
    trackEvent(next ? "mics_muted" : "mics_unmuted");
  }

  function togglePeerMute(peerId: string) {
    setMutedPeerIds((prev) => {
      const next = new Set(prev);
      if (next.has(peerId)) next.delete(peerId);
      else next.add(peerId);
      return next;
    });
  }

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      trackEvent("room_link_copied");
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      // Clipboard permission denied or unavailable — nothing sensible to do
      // beyond leaving the button unconfirmed.
    }
  }

  // A stored name means the client is still (re)connecting/registering
  // after a page reload — show a loading state instead of asking again.
  const restoring = !state.name && hasStoredName && !state.nameError;

  useEffect(() => {
    if (!validHandle || !state.name) return;
    signalingClient.joinRoom(handle);
    return () => {
      signalingClient.leaveRoom();
    };
  }, [validHandle, state.name, handle]);

  function handleNameSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = nameInput.trim();
    if (!trimmed) return;
    signalingClient.register(trimmed);
  }

  function handleRenameSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = renameInput.trim();
    if (!trimmed || trimmed === state.name) return;
    trackEvent("name_change");
    signalingClient.register(trimmed);
  }

  function handleSwitchSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = switchInput.trim();
    if (!HANDLE_RE.test(trimmed)) {
      setSwitchError("Use apenas letras, números, - e _.");
      return;
    }
    setSwitching(false);
    setSwitchInput("");
    setSwitchError(null);
    trackEvent("room_switch");
    router.push(`/watch/${toRoomHandle(trimmed, switchIsPrivate)}`);
  }

  if (!validHandle) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
          Essa sala não é válida.
        </p>
        <Link href="/" className="text-sm font-medium underline underline-offset-4">
          Voltar para o início
        </Link>
      </div>
    );
  }

  if (restoring) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
        <p className="text-zinc-600 dark:text-zinc-400">Reconectando...</p>
      </div>
    );
  }

  // Another connection under the same identity (a second tab, or another
  // device/reload that briefly overlapped this one) just took over — see
  // signalingClient's SUPERSEDED_CLOSE_CODE handling. This tab deliberately
  // stopped trying to reconnect instead of fighting the other one for the
  // identity forever, so tell the user what happened instead of it just
  // looking frozen.
  if (state.status === "superseded") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
          Essa sessão foi aberta em outra aba ou dispositivo.
        </p>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Só é possível ficar conectado com o mesmo nome em um lugar por vez.
        </p>
        <button
          type="button"
          onClick={() => state.name && signalingClient.register(state.name)}
          className="rounded-lg bg-zinc-950 px-4 py-2.5 font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
        >
          Usar esta aba
        </button>
      </div>
    );
  }

  if (!state.name) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 py-16">
        <main className="w-full max-w-md rounded-2xl border border-black/10 bg-white p-8 shadow-sm dark:border-white/10 dark:bg-zinc-950">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Entrar na sala {handle}
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Escolha um nome para entrar nesta sala.
          </p>
          <form onSubmit={handleNameSubmit} className="mt-8 flex flex-col gap-3">
            <label htmlFor="name" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Seu nome
            </label>
            <input
              id="name"
              autoFocus
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              maxLength={24}
              placeholder="Ex: Maria"
              className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
            {state.nameError && <p className="text-sm text-red-500">{state.nameError}</p>}
            <button
              type="submit"
              disabled={!nameInput.trim()}
              className="mt-2 rounded-lg bg-zinc-950 px-4 py-2.5 font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              Entrar na sala
            </button>
          </form>
        </main>
      </div>
    );
  }

  // Moderator "ghost" peers (see server/signaling.ts's admin-join) ride the
  // same peer list so their WebRTC connections get set up transparently,
  // but must never show up to real participants — filtered out here rather
  // than never added, so this is the one place that has to remember it.
  const visiblePeers = state.peers.filter((p) => p.role !== "moderator");
  const peerCount = visiblePeers.length + (state.name ? 1 : 0);
  const remoteEntries = Object.entries(remoteStreams);
  const nothingToShow = remoteEntries.length === 0 && !isSharing;
  const tileCount = remoteEntries.length + (isSharing && localStream ? 1 : 0);
  const isSingleTile = tileCount === 1;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-zinc-50 dark:bg-black">
      <header className="relative flex flex-wrap items-center justify-between gap-3 border-b border-black/10 px-4 py-3 dark:border-white/10">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">{handle}</h1>
          </div>
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium text-white ${
              isPrivateRoomHandle(handle) ? "bg-red-600" : "bg-emerald-600"
            }`}
          >
            {isPrivateRoomHandle(handle) ? "Sala privada" : "Sala pública"}
          </span>
          <span className="rounded-full bg-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
            {peerCount} {peerCount === 1 ? "pessoa" : "pessoas"}
          </span>
          <a
            href="https://discord.gg/nemtudo"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-red-600 hover:text-red-700 dark:text-red-500 dark:hover:text-red-400"
          >
            Reportar bug
          </a>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleCopyLink}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition ${
              linkCopied
                ? "border-emerald-600 text-emerald-600 dark:border-emerald-500 dark:text-emerald-500"
                : "border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
            }`}
          >
            {linkCopied ? (
              <CheckIcon className="h-4 w-4" />
            ) : (
              <LinkIcon className="h-4 w-4" />
            )}
            {linkCopied ? "Link copiado!" : "Compartilhar sala"}
          </button>

          <button
            type="button"
            onClick={() => {
              setSwitching(false);
              setRenaming((r) => {
                if (!r) setRenameInput(state.name ?? "");
                return !r;
              });
            }}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Mudar nome
          </button>

          <button
            type="button"
            onClick={() => {
              setRenaming(false);
              setSwitching((s) => !s);
            }}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Trocar de sala
          </button>

          <button
            type="button"
            onClick={toggleMic}
            title={isMicOn ? "Desativar microfone" : "Ativar microfone"}
            aria-label={isMicOn ? "Desativar microfone" : "Ativar microfone"}
            className={`rounded-lg p-2 text-white transition ${
              isMicOn ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"
            }`}
          >
            {isMicOn ? <MicIcon className="h-5 w-5" /> : <MicOffIcon className="h-5 w-5" />}
          </button>

          <button
            type="button"
            onClick={toggleNoiseSuppression}
            disabled={isMicOn && !noiseSuppressionAvailable}
            title={
              isMicOn && !noiseSuppressionAvailable
                ? "Supressão de ruído indisponível neste navegador"
                : noiseSuppressionOn
                  ? "Desativar supressão de ruído"
                  : "Ativar supressão de ruído"
            }
            aria-label={
              noiseSuppressionOn ? "Desativar supressão de ruído" : "Ativar supressão de ruído"
            }
            className={`rounded-lg p-2 text-white transition disabled:cursor-not-allowed disabled:opacity-50 ${
              noiseSuppressionOn ? "bg-emerald-600 hover:bg-emerald-700" : "bg-zinc-500 hover:bg-zinc-600"
            }`}
          >
            {noiseSuppressionOn ? (
              <NoiseSuppressionIcon className="h-5 w-5" />
            ) : (
              <NoiseSuppressionOffIcon className="h-5 w-5" />
            )}
          </button>

          <button
            type="button"
            onClick={toggleMicsMuted}
            title={micsMuted ? "Reativar microfones" : "Silenciar microfones"}
            aria-label={micsMuted ? "Reativar microfones" : "Silenciar microfones"}
            className={`rounded-lg p-2 text-white transition ${
              micsMuted ? "bg-red-600 hover:bg-red-700" : "bg-emerald-600 hover:bg-emerald-700"
            }`}
          >
            {micsMuted ? (
              <HeadphonesOffIcon className="h-5 w-5" />
            ) : (
              <HeadphonesIcon className="h-5 w-5" />
            )}
          </button>

          <label className="sr-only" htmlFor="share-resolution">
            Resolução da transmissão
          </label>
          <select
            id="share-resolution"
            value={shareResolution}
            onChange={(e) => setShareResolution(e.target.value as typeof shareResolution)}
            title="Resolução — reduza se a sala estiver travando"
            className="rounded-lg border border-zinc-300 bg-white px-2 py-2 text-sm font-medium text-zinc-700 outline-none transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {SHARE_RESOLUTION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          <label className="sr-only" htmlFor="share-fps">
            FPS da transmissão
          </label>
          <select
            id="share-fps"
            value={shareFps}
            onChange={(e) => setShareFps(Number(e.target.value) as typeof shareFps)}
            title="Taxa de quadros — reduza se a sala estiver travando"
            className="rounded-lg border border-zinc-300 bg-white px-2 py-2 text-sm font-medium text-zinc-700 outline-none transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {SHARE_FPS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          <label className="sr-only" htmlFor="share-bitrate">
            Bitrate da transmissão
          </label>
          <select
            id="share-bitrate"
            value={shareBitrate}
            onChange={(e) => setShareBitrate(e.target.value as typeof shareBitrate)}
            title="Bitrate — reduza se a sala estiver travando"
            className="rounded-lg border border-zinc-300 bg-white px-2 py-2 text-sm font-medium text-zinc-700 outline-none transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {SHARE_BITRATE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          {isSharing ? (
            <button
              type="button"
              onClick={stopShare}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700"
            >
              Parar compartilhamento
            </button>
          ) : screenShareMode === "display" ? (
            <>
              <button
                type="button"
                onClick={() => startShare("display")}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700"
              >
                Compartilhar tela
              </button>
              <button
                type="button"
                onClick={() => startShare("camera")}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700"
              >
                Compartilhar câmera
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => startShare()}
              disabled={screenShareMode === "unsupported"}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Compartilhar câmera
            </button>
          )}
        </div>

        {renaming && (
          <form
            onSubmit={handleRenameSubmit}
            className="absolute inset-x-4 top-full z-20 mt-2 rounded-lg border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-800 dark:bg-zinc-950 sm:inset-x-auto sm:right-4 sm:w-72"
          >
            <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Novo nome
            </label>
            <input
              autoFocus
              value={renameInput}
              onChange={(e) => setRenameInput(e.target.value)}
              maxLength={24}
              placeholder="Ex: Maria"
              className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
            {state.nameError && <p className="mt-1 text-xs text-red-500">{state.nameError}</p>}
            <button
              type="submit"
              disabled={!renameInput.trim() || renameInput.trim() === state.name}
              className="mt-2 w-full rounded-md bg-zinc-950 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              Salvar nome
            </button>
          </form>
        )}

        {switching && (
          <form
            onSubmit={handleSwitchSubmit}
            className="absolute inset-x-4 top-full z-20 mt-2 rounded-lg border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-800 dark:bg-zinc-950 sm:inset-x-auto sm:right-4 sm:w-72"
          >
            <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Nova sala
            </label>
            <input
              autoFocus
              value={switchInput}
              onChange={(e) => setSwitchInput(e.target.value)}
              placeholder="Ex: reuniao-time"
              className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
            <label className="mt-2 flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
              <input
                type="checkbox"
                checked={switchIsPrivate}
                onChange={(e) => setSwitchIsPrivate(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-zinc-300 dark:border-zinc-700"
              />
              Sala privada
            </label>
            {switchError && <p className="mt-1 text-xs text-red-500">{switchError}</p>}
            <button
              type="submit"
              disabled={!switchInput.trim()}
              className="mt-2 w-full rounded-md bg-zinc-950 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              Ir para a sala
            </button>
            <Link
              href="/rooms"
              className="mt-2 block text-center text-xs font-medium text-zinc-500 underline underline-offset-2 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
            >
              Ver salas públicas ativas
            </Link>
          </form>
        )}
      </header>

      {shareError && (
        <p className="bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400">
          {shareError}
        </p>
      )}
      {micError && (
        <p className="bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400">
          {micError}
        </p>
      )}

      {Object.entries(remoteMicStreams).map(([peerId, stream]) => (
        <RemoteAudio key={peerId} stream={stream} muted={micsMuted || mutedPeerIds.has(peerId)} />
      ))}

      <div className="flex min-h-0 flex-1 flex-col gap-6 p-4 lg:flex-row">
        <main className="min-h-0 flex-1 overflow-y-auto">
          {nothingToShow ? (
            <div className="flex h-full min-h-[300px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-300 text-center dark:border-zinc-800">
              <p className="text-zinc-600 dark:text-zinc-400">
                Ninguém está transmitindo ainda.
              </p>
              <p className="text-sm text-zinc-500 dark:text-zinc-500">
                {screenShareMode === "camera"
                  ? 'Clique em "Compartilhar câmera" para começar.'
                  : 'Clique em "Compartilhar tela" para começar.'}
              </p>
            </div>
          ) : (
            <div
              className={
                isSingleTile
                  ? "h-full min-h-[300px]"
                  : "grid grid-cols-1 gap-5 sm:grid-cols-2 2xl:grid-cols-3"
              }
            >
              {isSharing && localStream && (
                <VideoTile
                  stream={localStream}
                  label="Você"
                  badge={shareSource === "camera" ? "câmera" : "transmitindo"}
                  muted
                  allowUnmute={false}
                  fill={isSingleTile}
                />
              )}
              {remoteEntries.map(([peerId, stream]) => {
                const peerName = state.peers.find((p) => p.id === peerId)?.name ?? "Alguém";
                return (
                  <VideoTile
                    key={peerId}
                    stream={stream}
                    label={peerName}
                    badge="ao vivo"
                    muted
                    fill={isSingleTile}
                  />
                );
              })}
            </div>
          )}
        </main>

        <aside className="w-full shrink-0 lg:w-64">
          <h2 className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            Participantes
          </h2>
          <ul className="flex flex-col gap-1.5">
            <ParticipantRow
              name={state.name}
              isSelf
              micOn={isMicOn}
              sharing={isSharing}
              micStream={localMicStream}
            />
            {visiblePeers.map((p) => (
              <ParticipantRow
                key={p.id}
                name={p.name}
                micOn={p.mic}
                sharing={p.sharing}
                micStream={remoteMicStreams[p.id]}
                muted={micsMuted || mutedPeerIds.has(p.id)}
                onToggleMute={() => togglePeerMute(p.id)}
              />
            ))}
          </ul>

          <ChatPanel
            messages={state.chatMessages}
            selfId={state.selfId}
            onSend={(text) => signalingClient.sendChatMessage(text)}
          />
        </aside>
      </div>
    </div>
  );
}
