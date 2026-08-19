"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { adminLogin, adminLogout, useAdminToken } from "@/lib/adminApi";
import { DashboardPanel } from "./DashboardPanel";
import { ModerationPanel } from "./ModerationPanel";

type Tab = "dashboard" | "moderation";

const TABS: { value: Tab; label: string }[] = [
  { value: "dashboard", label: "Dashboard" },
  { value: "moderation", label: "Moderação" },
];

export default function AdminPage() {
  const token = useAdminToken();
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [tab, setTab] = useState<Tab>("dashboard");

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

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 px-4 py-10 dark:bg-black">
      <div className="mx-auto w-full max-w-3xl">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
              Admin
            </h1>
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

        <div className="mt-6 flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
          {TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setTab(t.value)}
              className={`-mb-px rounded-t-lg border-b-2 px-4 py-2 text-sm font-medium transition ${
                tab === t.value
                  ? "border-zinc-950 text-zinc-950 dark:border-zinc-50 dark:text-zinc-50"
                  : "border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="mt-6">
          {tab === "dashboard" ? <DashboardPanel /> : <ModerationPanel />}
        </div>
      </div>
    </div>
  );
}
