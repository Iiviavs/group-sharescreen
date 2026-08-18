"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signalingClient } from "@/lib/signalingClient";
import { useSignaling } from "@/lib/useSignaling";
import { useRoomMedia } from "@/lib/useRoomMedia";
import { VideoTile } from "@/components/VideoTile";

const HANDLE_RE = /^[a-zA-Z0-9_-]+$/;

export function WatchRoom({ handle }: { handle: string }) {
  const router = useRouter();
  const state = useSignaling();
  const validHandle = HANDLE_RE.test(handle);

  const { isSharing, startShare, stopShare, localStream, remoteStreams, shareError } =
    useRoomMedia(handle);

  const [switching, setSwitching] = useState(false);
  const [switchInput, setSwitchInput] = useState("");
  const [switchError, setSwitchError] = useState<string | null>(null);

  useEffect(() => {
    if (!validHandle) return;
    if (state.status === "idle" || state.status === "connecting") return;
    if (!state.name) {
      sessionStorage.setItem("pendingRoom", handle);
      router.replace("/");
    }
  }, [state.name, state.status, handle, router, validHandle]);

  useEffect(() => {
    if (!validHandle || !state.name) return;
    signalingClient.joinRoom(handle);
    return () => {
      signalingClient.leaveRoom();
    };
  }, [validHandle, state.name, handle]);

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

        <div className="flex items-center gap-2">
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
                className="absolute right-0 top-full z-10 mt-2 w-64 rounded-lg border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-800 dark:bg-zinc-950"
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
              {isSharing && <span className="h-2 w-2 rounded-full bg-emerald-500" title="transmitindo" />}
            </li>
            {state.peers.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between rounded-lg px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300"
              >
                <span>{p.name}</span>
                {p.sharing && <span className="h-2 w-2 rounded-full bg-emerald-500" title="transmitindo" />}
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}
