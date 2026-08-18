"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { adminLogin, adminLogout, fetchAdminRooms, useAdminToken, type AdminRoom } from "@/lib/adminApi";

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

export default function AdminPage() {
  const token = useAdminToken();
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);

  const [rooms, setRooms] = useState<AdminRoom[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!token) return;
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
        // useAdminToken picks that up on its own and this whole effect
        // re-runs (token becomes null), no local state to reset here.
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
  }, [token]);

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setLoggingIn(true);
    setLoginError(null);
    try {
      await adminLogin(user, password);
      setPassword("");
    } catch {
      setLoginError("Usuário ou senha inválidos.");
    } finally {
      setLoggingIn(false);
    }
  }

  function handleLogout() {
    adminLogout();
    setRooms(null);
  }

  if (!token) {
    return (
      <div className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-16 dark:bg-black">
        <main className="w-full max-w-md rounded-2xl border border-black/10 bg-white p-8 shadow-sm dark:border-white/10 dark:bg-zinc-950">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Moderação
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Acesso restrito. Entre com as credenciais de administrador.
          </p>
          <form onSubmit={handleLogin} className="mt-8 flex flex-col gap-3">
            <label htmlFor="user" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Usuário
            </label>
            <input
              id="user"
              autoFocus
              autoComplete="username"
              value={user}
              onChange={(e) => setUser(e.target.value)}
              className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
            <label htmlFor="password" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Senha
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
            {loginError && <p className="text-sm text-red-500">{loginError}</p>}
            <button
              type="submit"
              disabled={!user.trim() || !password || loggingIn}
              className="mt-2 rounded-lg bg-zinc-950 px-4 py-2.5 font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              {loggingIn ? "Entrando..." : "Entrar"}
            </button>
          </form>
        </main>
      </div>
    );
  }

  const filtered = (rooms ?? []).filter((r) =>
    r.handle.toLowerCase().includes(search.trim().toLowerCase())
  );

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 px-4 py-10 dark:bg-black">
      <div className="mx-auto w-full max-w-3xl">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
              Moderação
            </h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Todas as salas ativas, públicas e privadas. Visualizar não avisa os participantes.
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Link
              href="/"
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              Início
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              Sair
            </button>
          </div>
        </div>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Pesquisar sala por nome..."
          className="mt-6 w-full rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
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
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {room.peers.map((p) => (
                      <li
                        key={p.id}
                        className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400"
                      >
                        {p.name ?? "sem nome"}
                        {p.sharing ? " · tela" : ""}
                        {p.mic ? " · mic" : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
