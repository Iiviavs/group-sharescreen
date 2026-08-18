"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signalingClient } from "@/lib/signalingClient";
import { useSignaling, useHasStoredName } from "@/lib/useSignaling";
import { trackEvent } from "@/lib/analytics";
import { toRoomHandle } from "@/lib/roomsApi";

const HANDLE_RE = /^[a-zA-Z0-9_-]+$/;

export default function Home() {
  const state = useSignaling();
  const router = useRouter();

  const [nameInput, setNameInput] = useState("");
  const [roomInput, setRoomInput] = useState("");
  const [roomError, setRoomError] = useState<string | null>(null);
  const [roomIsPrivate, setRoomIsPrivate] = useState(false);
  const [changingName, setChangingName] = useState(false);
  const hasStoredName = useHasStoredName();
  const previousNameRef = useRef(state.name);

  const registered = Boolean(state.name);
  const restoring = !registered && hasStoredName && !state.nameError;

  // Closes the rename form once the name actually changes (success or a
  // plain reconnect landing on the same name), without guessing at timing.
  useEffect(() => {
    if (changingName && state.name !== previousNameRef.current) {
      setChangingName(false);
      setNameInput("");
    }
    previousNameRef.current = state.name;
  }, [state.name, changingName]);

  function handleNameSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = nameInput.trim();
    if (!trimmed || trimmed === state.name) return;
    if (registered) trackEvent("name_change");
    signalingClient.register(trimmed);
  }

  function handleRoomSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = roomInput.trim();
    if (!HANDLE_RE.test(trimmed)) {
      setRoomError("Use apenas letras, números, - e _.");
      return;
    }
    setRoomError(null);
    router.push(`/watch/${toRoomHandle(trimmed, roomIsPrivate)}`);
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-16 dark:bg-black">
      <main className="w-full max-w-md rounded-2xl border border-black/10 bg-white p-8 shadow-sm dark:border-white/10 dark:bg-zinc-950">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          GoLive
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Compartilhe sua tela com quem estiver na mesma sala, sem cadastro.
        </p>
        <Link
          href="/rooms"
          className="mt-3 inline-block text-sm font-medium underline underline-offset-2 text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          Ver salas públicas ativas
        </Link>

        {restoring ? (
          <p className="mt-8 text-sm text-zinc-500 dark:text-zinc-400">Reconectando...</p>
        ) : !registered || changingName ? (
          <form onSubmit={handleNameSubmit} className="mt-8 flex flex-col gap-3">
            <label htmlFor="name" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {registered ? "Novo nome" : "Escolha seu nome"}
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
            {state.nameError && (
              <p className="text-sm text-red-500">{state.nameError}</p>
            )}
            <div className="mt-2 flex gap-2">
              <button
                type="submit"
                disabled={!nameInput.trim() || nameInput.trim() === state.name}
                className="flex-1 rounded-lg bg-zinc-950 px-4 py-2.5 font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
              >
                {registered ? "Salvar nome" : "Confirmar nome"}
              </button>
              {registered && (
                <button
                  type="button"
                  onClick={() => {
                    setChangingName(false);
                    setNameInput("");
                  }}
                  className="rounded-lg border border-zinc-300 px-4 py-2.5 font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                >
                  Cancelar
                </button>
              )}
            </div>
          </form>
        ) : (
          <form onSubmit={handleRoomSubmit} className="mt-8 flex flex-col gap-3">
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Conectado como{" "}
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">{state.name}</span>{" "}
              <button
                type="button"
                onClick={() => {
                  setNameInput(state.name ?? "");
                  setChangingName(true);
                }}
                className="font-medium underline underline-offset-2 hover:text-zinc-700 dark:hover:text-zinc-300"
              >
                Trocar
              </button>
            </p>
            <label htmlFor="room" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Para qual sala você quer ir ou criar?
            </label>
            <input
              id="room"
              autoFocus
              value={roomInput}
              onChange={(e) => setRoomInput(e.target.value)}
              placeholder="Ex: reuniao-time"
              className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
            <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
              <input
                type="checkbox"
                checked={roomIsPrivate}
                onChange={(e) => setRoomIsPrivate(e.target.checked)}
                className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-700"
              />
              Sala privada (não aparece na lista de salas públicas)
            </label>
            {roomError && <p className="text-sm text-red-500">{roomError}</p>}
            <button
              type="submit"
              disabled={!roomInput.trim()}
              className="mt-2 rounded-lg bg-zinc-950 px-4 py-2.5 font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              Entrar na sala
            </button>
          </form>
        )}
      </main>
    </div>
  );
}
