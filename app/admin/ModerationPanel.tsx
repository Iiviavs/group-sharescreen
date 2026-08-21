"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchAdminRooms, banIp, type AdminRoom } from "@/lib/adminApi";
import { DisplayUserName } from "@/components/DisplayUserName";

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

export function ModerationPanel() {
  const [rooms, setRooms] = useState<AdminRoom[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [banningIp, setBanningIp] = useState<string | null>(null);
  const [bannedIps, setBannedIps] = useState<Set<string>>(new Set());

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

  async function handleBanPeer(ip: string, roomHandle: string) {
    if (!window.confirm(`Banir o IP ${ip}? Ele será desconectado imediatamente.`)) return;
    setBanningIp(ip);
    try {
      await banIp({ ip, reason: `Banido a partir da sala ${roomHandle}` });
      setBannedIps((prev) => new Set(prev).add(ip));
    } catch {
      setError("Falha ao banir o IP.");
    } finally {
      setBanningIp(null);
    }
  }

  const filtered = (rooms ?? []).filter((r) =>
    r.handle.toLowerCase().includes(search.trim().toLowerCase())
  );

  return (
    <div>
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Pesquisar sala por nome..."
        className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
      />

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

        <ul className="flex flex-col gap-3">
          {filtered.map((room) => (
            <li
              key={room.handle}
              className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-semibold text-zinc-900 dark:text-zinc-100">
                      {room.handle}
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
                  </p>
                </div>
                <Link
                  href={`/admin/room/${room.handle}`}
                  className="shrink-0 rounded-lg bg-zinc-950 px-3 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
                >
                  Visualizar
                </Link>
              </div>
              {room.peers.length > 0 && (
                <ul className="mt-3 flex flex-col gap-1.5">
                  {room.peers.map((p) => {
                    const isBanned = bannedIps.has(p.ip);
                    return (
                      <li
                        key={p.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-zinc-100 px-2.5 py-1.5 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400"
                      >
                        <span>
                          <DisplayUserName name={p.name ?? "sem nome"} isGuest={p.isGuest} />
                          {p.sharing ? " · tela" : ""}
                          {p.mic ? " · mic" : ""}
                          <span className="ml-1.5 font-mono text-zinc-400 dark:text-zinc-500">{p.ip}</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => handleBanPeer(p.ip, room.handle)}
                          disabled={isBanned || banningIp === p.ip}
                          className="shrink-0 rounded-md border border-red-300 px-2 py-1 text-[11px] font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
                        >
                          {isBanned ? "Banido" : banningIp === p.ip ? "Banindo..." : "Banir IP"}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
