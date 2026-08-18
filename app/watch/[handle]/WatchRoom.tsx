"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signalingClient } from "@/lib/signalingClient";
import { useSignaling, useHasStoredName } from "@/lib/useSignaling";
import { useRoomMedia } from "@/lib/useRoomMedia";
import { trackEvent } from "@/lib/analytics";
import { VideoTile } from "@/components/VideoTile";
import { RemoteAudio } from "@/components/RemoteAudio";

const HANDLE_RE = /^[a-zA-Z0-9_-]+$/;

export function WatchRoom({ handle }: { handle: string }) {
  const router = useRouter();
  const state = useSignaling();
  const hasStoredName = useHasStoredName();
  const validHandle = HANDLE_RE.test(handle);

  const {
    isSharing,
    startShare,
    stopShare,
    localStream,
    remoteStreams,
    shareError,
    isMicOn,
    toggleMic,
    micError,
    remoteMicStreams,
  } = useRoomMedia(handle);

  const [switching, setSwitching] = useState(false);
  const [switchInput, setSwitchInput] = useState("");
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [micsMuted, setMicsMuted] = useState(false);

  function toggleMicsMuted() {
    const next = !micsMuted;
    setMicsMuted(next);
    trackEvent(next ? "mics_muted" : "mics_unmuted");
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
    router.push(`/watch/${trimmed}`);
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

  const peerCount = state.peers.length + (state.name ? 1 : 0);
  const remoteEntries = Object.entries(remoteStreams);
  const nothingToShow = remoteEntries.length === 0 && !isSharing;

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-black/10 px-4 py-3 dark:border-white/10">
        <div className="flex items-center gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Sala</p>
            <h1 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">{handle}</h1>
          </div>
          <span className="rounded-full bg-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
            {peerCount} {peerCount === 1 ? "pessoa" : "pessoas"}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <button
              type="button"
              onClick={() => setSwitching((s) => !s)}
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              Trocar de sala
            </button>
            {switching && (
              <form
                onSubmit={handleSwitchSubmit}
                className="absolute right-0 top-full z-10 mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-lg border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-800 dark:bg-zinc-950"
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
                {switchError && <p className="mt-1 text-xs text-red-500">{switchError}</p>}
                <button
                  type="submit"
                  disabled={!switchInput.trim()}
                  className="mt-2 w-full rounded-md bg-zinc-950 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
                >
                  Ir para a sala
                </button>
              </form>
            )}
          </div>

          <button
            type="button"
            onClick={toggleMic}
            className={`rounded-lg px-4 py-2 text-sm font-semibold text-white transition ${
              isMicOn ? "bg-red-600 hover:bg-red-700" : "bg-zinc-700 hover:bg-zinc-600"
            }`}
          >
            {isMicOn ? "Desativar microfone" : "Ativar microfone"}
          </button>

          <button
            type="button"
            onClick={toggleMicsMuted}
            className={`rounded-lg px-4 py-2 text-sm font-semibold text-white transition ${
              micsMuted ? "bg-amber-600 hover:bg-amber-700" : "bg-zinc-700 hover:bg-zinc-600"
            }`}
          >
            {micsMuted ? "Reativar microfones" : "Silenciar microfones"}
          </button>

          <button
            type="button"
            onClick={isSharing ? stopShare : startShare}
            className={`rounded-lg px-4 py-2 text-sm font-semibold text-white transition ${
              isSharing ? "bg-red-600 hover:bg-red-700" : "bg-emerald-600 hover:bg-emerald-700"
            }`}
          >
            {isSharing ? "Parar compartilhamento" : "Compartilhar tela"}
          </button>
        </div>
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
        <RemoteAudio key={peerId} stream={stream} muted={micsMuted} />
      ))}

      <div className="flex flex-1 flex-col gap-6 p-4 lg:flex-row">
        <main className="flex-1">
          {nothingToShow ? (
            <div className="flex h-full min-h-[300px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-300 text-center dark:border-zinc-800">
              <p className="text-zinc-600 dark:text-zinc-400">
                Ninguém está transmitindo a tela ainda.
              </p>
              <p className="text-sm text-zinc-500 dark:text-zinc-500">
                Clique em &quot;Compartilhar tela&quot; para começar.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {isSharing && localStream && (
                <VideoTile
                  stream={localStream}
                  label="Você"
                  badge="transmitindo"
                  muted
                  allowUnmute={false}
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
            <li className="flex items-center justify-between rounded-lg bg-zinc-100 px-3 py-2 text-sm dark:bg-zinc-900">
              <span className="font-medium text-zinc-900 dark:text-zinc-100">
                {state.name} <span className="text-zinc-500">(você)</span>
              </span>
              <span className="flex items-center gap-1.5">
                {isMicOn && <span className="h-2 w-2 rounded-full bg-sky-500" title="microfone ativo" />}
                {isSharing && <span className="h-2 w-2 rounded-full bg-emerald-500" title="transmitindo" />}
              </span>
            </li>
            {state.peers.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between rounded-lg px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300"
              >
                <span>{p.name}</span>
                <span className="flex items-center gap-1.5">
                  {p.mic && <span className="h-2 w-2 rounded-full bg-sky-500" title="microfone ativo" />}
                  {p.sharing && <span className="h-2 w-2 rounded-full bg-emerald-500" title="transmitindo" />}
                </span>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}
